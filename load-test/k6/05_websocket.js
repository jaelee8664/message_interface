/**
 * [05] WebSocket 부하 테스트
 * ──────────────────────────
 * 목적: "다수의 WebSocket 클라이언트가 동시에 연결·메시지 전송 시 안정성"
 * 시나리오:
 *   - 50 VU가 각각 WebSocket 연결을 맺고 메시지를 연속 전송
 *   - 연결 지속 시간: 30초
 *   - 각 VU는 연결 유지 중 메시지를 2초마다 전송
 *
 * 전제 조건:
 *   setup/create-workflows.sh 로 lt-websocket 워크플로우가 등록되어 있어야 함
 *   (NODE0: WEBSOCKET_SERVER, path=/load-test/ws)
 *
 * 주목할 것:
 *   - 연결 성공률 (connected rate)
 *   - 메시지 전송 오류 수 (send errors)
 *   - 서버 측 /synapse/monitor/status 의 webSocketServer 세션 수
 *
 * 실행:
 *   k6 run k6/05_websocket.js
 */

import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { WS_URL, ENDPOINTS, makePayload } from './config.js';

const wsConnected   = new Rate('ws_connected');
const wsMsgSent     = new Counter('ws_messages_sent');
const wsMsgError    = new Counter('ws_message_errors');
const wsConnectTime = new Trend('ws_connect_duration_ms', true);

export const options = {
  stages: [
    { duration: '15s', target: 50 },  // 점진적으로 50 연결 맺기
    { duration: '1m',  target: 50 },  // 50 연결 유지
    { duration: '15s', target: 0  },  // 연결 해제
  ],
  thresholds: {
    ws_connected:            ['rate>0.95'],  // 95% 이상 연결 성공
    ws_message_errors:       ['count<10'],   // 메시지 전송 오류 10 미만
    ws_connect_duration_ms:  ['p(95)<500'],  // 연결 수립 시간 500ms 이하
  },
};

export default function () {
  const url = `${WS_URL}${ENDPOINTS.ws}`;
  const connectStart = Date.now();

  const res = ws.connect(url, {}, function (socket) {
    wsConnectTime.add(Date.now() - connectStart);

    socket.on('open', () => {
      wsConnected.add(true);

      // 연결 후 주기적으로 메시지 전송
      let msgCount = 0;
      const interval = socket.setInterval(() => {
        try {
          socket.send(makePayload({ seq: msgCount++ }));
          wsMsgSent.add(1);
        } catch (e) {
          wsMsgError.add(1);
        }
      }, 2000);  // 2초 간격

      // 30초 후 연결 종료
      socket.setTimeout(() => {
        socket.clearInterval(interval);
        socket.close();
      }, 30000);
    });

    socket.on('message', (data) => {
      // 서버에서 응답이 있을 경우 체크
      check(data, { 'ws: received response': (d) => d !== null });
    });

    socket.on('error', (e) => {
      wsConnected.add(false);
      wsMsgError.add(1);
    });

    socket.on('close', () => {
      // 연결 정상 종료
    });
  });

  check(res, {
    'ws: connection established': (r) => r && r.status === 101,
  });

  sleep(1);
}
