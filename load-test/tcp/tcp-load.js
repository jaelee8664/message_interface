#!/usr/bin/env node
/**
 * TCP 부하 테스트
 * ──────────────
 * Node.js 내장 `net` 모듈만 사용 → npm install 불필요
 *
 * 이 테스트가 필요한 이유:
 *   - message-interface는 TCP_SERVER 프로토콜을 지원
 *   - k6는 raw TCP를 지원하지 않으므로 Node.js로 별도 구현
 *   - TcpServerSessionRegistry, RawTcpInboundHandler 의 실제 부하 측정
 *
 * 전제 조건:
 *   - TCP_SERVER 프로토콜로 수신하는 워크플로우 단위가 등록되어 있어야 함
 *   - 서버 포트 확인: reference.yaml → tcpPort (기본 9090)
 *
 * 실행:
 *   node tcp/tcp-load.js                         # 기본 설정
 *   node tcp/tcp-load.js --host 192.168.1.10     # 다른 서버
 *   node tcp/tcp-load.js --port 9090 --vus 50 --duration 60
 *
 * 주요 출력 지표:
 *   - 연결 성공률 (connected/attempted)
 *   - 메시지 처리량 (msg/s)
 *   - 응답 지연 p50/p95/p99
 *   - 에러 수 및 종류
 */

const net  = require('net');

// ── CLI 파라미터 파싱 ────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
const HOST     = args.host     || 'localhost';
const PORT     = parseInt(args.port || '9090', 10);
const VUS      = parseInt(args.vus  || '10',   10);
const DURATION = parseInt(args.duration || '30', 10) * 1000; // ms
const RAMP     = parseInt(args.ramp     || '5',  10) * 1000; // ramp-up ms
const MSG_INTERVAL_MS = parseInt(args.interval || '200', 10);

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      result[argv[i].slice(2)] = argv[i + 1] || true;
      i++;
    }
  }
  return result;
}

// ── 통계 수집 ────────────────────────────────────────────────────────────────
const stats = {
  attempted:  0,
  connected:  0,
  msgSent:    0,
  msgReceived: 0,
  errors:     0,
  latencies:  [],   // ms 배열
  startTime:  Date.now(),
};

// ── 페이로드 생성 ─────────────────────────────────────────────────────────────
function makePayload(seq) {
  const msg = JSON.stringify({
    id:        seq,
    name:      `tcp-test-${seq % 100}`,
    value:     seq % 100,
    timestamp: new Date().toISOString(),
  });
  // 길이 접두사 프레이밍 (4바이트 big-endian) — RawTcpInboundHandler 프레임 형식 확인 필요
  // 이 모듈이 길이 프레임을 사용하지 않는다면 아래 주석 해제하고 단순 전송으로 교체
  // return Buffer.from(msg + '\n');  // 개행 구분 방식
  const buf = Buffer.from(msg);
  const frame = Buffer.allocUnsafe(4 + buf.length);
  frame.writeUInt32BE(buf.length, 0);
  buf.copy(frame, 4);
  return frame;
}

// ── 백분위수 계산 ─────────────────────────────────────────────────────────────
function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ── VU(Virtual User) 실행 ─────────────────────────────────────────────────────
function runVU(vuId, startDelay) {
  return new Promise((resolve) => {
    setTimeout(() => {
      stats.attempted++;
      const socket = new net.Socket();
      let seq = 0;
      let interval = null;
      let connected = false;
      let sendTimes = new Map();  // seq → 전송 시각

      socket.setTimeout(5000);  // 연결 타임아웃

      socket.connect(PORT, HOST, () => {
        connected = true;
        stats.connected++;

        // 주기적으로 메시지 전송
        interval = setInterval(() => {
          if (socket.destroyed) return;
          const thisSeq = seq++;
          sendTimes.set(thisSeq, Date.now());
          try {
            socket.write(makePayload(thisSeq));
            stats.msgSent++;
          } catch (e) {
            stats.errors++;
          }
        }, MSG_INTERVAL_MS);
      });

      socket.on('data', (data) => {
        // 응답 수신 시 지연 시간 기록
        stats.msgReceived++;
        // 단순히 마지막 전송 기준으로 지연 측정 (TCP는 요청-응답 1:1 매핑 어려움)
        const now = Date.now();
        const sentTime = sendTimes.size > 0 ? sendTimes.values().next().value : now;
        const latency = now - sentTime;
        if (latency >= 0 && latency < 30000) stats.latencies.push(latency);
        // 가장 오래된 항목 제거 (메모리 관리)
        if (sendTimes.size > 100) {
          const firstKey = sendTimes.keys().next().value;
          sendTimes.delete(firstKey);
        }
      });

      socket.on('error', (e) => {
        stats.errors++;
        if (!connected) stats.attempted;  // 연결 실패 카운트 (이미 attempted에 포함)
      });

      socket.on('timeout', () => {
        if (!connected) stats.errors++;
        socket.destroy();
      });

      socket.on('close', () => {
        if (interval) clearInterval(interval);
        resolve();
      });

      // 테스트 시간 후 연결 종료
      setTimeout(() => {
        if (interval) clearInterval(interval);
        if (!socket.destroyed) socket.destroy();
      }, DURATION);

    }, startDelay);
  });
}

// ── 진행 상황 출력 ────────────────────────────────────────────────────────────
function printProgress() {
  const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(0);
  const throughput = (stats.msgSent / Math.max(1, (Date.now() - stats.startTime) / 1000)).toFixed(1);
  process.stdout.write(
    `\r[${elapsed}s] 연결: ${stats.connected}/${stats.attempted} | ` +
    `전송: ${stats.msgSent} | 수신: ${stats.msgReceived} | ` +
    `에러: ${stats.errors} | 처리량: ${throughput} msg/s   `
  );
}

// ── 최종 리포트 출력 ──────────────────────────────────────────────────────────
function printReport() {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  console.log('\n\n═══════════════════════════════════════════════');
  console.log('         TCP 부하 테스트 결과 리포트');
  console.log('═══════════════════════════════════════════════');
  console.log(`  호스트:          ${HOST}:${PORT}`);
  console.log(`  VU 수:           ${VUS}`);
  console.log(`  테스트 시간:     ${elapsed.toFixed(1)}s`);
  console.log('');
  console.log('  [ 연결 ]');
  console.log(`  연결 시도:       ${stats.attempted}`);
  console.log(`  연결 성공:       ${stats.connected}`);
  console.log(`  연결 성공률:     ${((stats.connected / Math.max(1, stats.attempted)) * 100).toFixed(1)}%`);
  console.log('');
  console.log('  [ 메시지 ]');
  console.log(`  전송:            ${stats.msgSent}`);
  console.log(`  수신:            ${stats.msgReceived}`);
  console.log(`  처리량:          ${(stats.msgSent / elapsed).toFixed(1)} msg/s`);
  console.log('');
  console.log('  [ 지연 시간 (응답 있는 경우) ]');
  if (stats.latencies.length > 0) {
    console.log(`  p50:             ${percentile(stats.latencies, 50).toFixed(0)} ms`);
    console.log(`  p95:             ${percentile(stats.latencies, 95).toFixed(0)} ms`);
    console.log(`  p99:             ${percentile(stats.latencies, 99).toFixed(0)} ms`);
    console.log(`  최대:            ${Math.max(...stats.latencies).toFixed(0)} ms`);
  } else {
    console.log('  (서버 응답 없음 — 단방향 전송 또는 NODE4 미설정)');
  }
  console.log('');
  console.log('  [ 에러 ]');
  console.log(`  에러 수:         ${stats.errors}`);
  console.log('═══════════════════════════════════════════════');

  // PASS/FAIL 판정
  const connRate = stats.connected / Math.max(1, stats.attempted);
  const errRate  = stats.errors / Math.max(1, stats.msgSent);
  const p95      = percentile(stats.latencies, 95);

  console.log('\n  [ 판정 ]');
  check('연결 성공률 ≥ 95%',  connRate >= 0.95);
  check('에러율 < 1%',        errRate  < 0.01);
  if (stats.latencies.length > 0) {
    check('p95 응답 < 500ms', p95 < 500);
  }
  console.log('');
}

function check(label, condition) {
  const icon = condition ? '✓' : '✗';
  console.log(`  ${icon} ${label}`);
}

// ── 메인 실행 ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nTCP 부하 테스트 시작 — ${HOST}:${PORT}`);
  console.log(`VU: ${VUS} | 지속시간: ${DURATION / 1000}s | 메시지 간격: ${MSG_INTERVAL_MS}ms`);
  console.log('─────────────────────────────────────────────────\n');

  // ramp-up: VU를 점진적으로 시작
  const rampDelay = RAMP / VUS;
  const progressInterval = setInterval(printProgress, 500);

  const vuPromises = Array.from({ length: VUS }, (_, i) =>
    runVU(i, Math.floor(i * rampDelay))
  );

  await Promise.all(vuPromises);
  clearInterval(progressInterval);
  printReport();
}

main().catch((e) => {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});
