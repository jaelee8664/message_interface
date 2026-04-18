plugins {
	kotlin("jvm") version "2.2.21"
	kotlin("plugin.spring") version "2.2.21"
	id("org.springframework.boot") version "4.0.3"
	id("io.spring.dependency-management") version "1.1.7"
}

group = "com.synapse"
version = "0.0.1-SNAPSHOT"
description = "message-inteface workflow"

java {
	toolchain {
		languageVersion = JavaLanguageVersion.of(17)
	}
}

repositories {
	mavenCentral()
}

// Replace Spring Boot's default Logback with Log4j2 + LMAX Disruptor (all-async)
configurations.all {
	exclude(group = "org.springframework.boot", module = "spring-boot-starter-logging")
}

dependencies {
	implementation("org.springframework.boot:spring-boot-starter-log4j2")
	implementation("com.lmax:disruptor:3.4.4")
	implementation("org.springframework.boot:spring-boot-starter-kafka")
	implementation("org.springframework.boot:spring-boot-starter-data-mongodb-reactive")
	implementation("org.springframework.boot:spring-boot-starter-security")
	implementation("org.springframework.boot:spring-boot-starter-webflux")
	implementation("io.projectreactor.kotlin:reactor-kotlin-extensions")
	implementation("org.jetbrains.kotlin:kotlin-reflect")
	implementation("org.jetbrains.kotlinx:kotlinx-coroutines-reactor")
	implementation("tools.jackson.module:jackson-module-kotlin")
	implementation("org.graalvm.polyglot:polyglot:24.1.2")
	implementation("org.graalvm.polyglot:js-community:24.1.2")
	implementation("tools.jackson.dataformat:jackson-dataformat-xml")
	implementation("io.projectreactor.netty:reactor-netty-core")
	implementation("org.springframework.boot:spring-boot-reactor-netty")
	implementation("io.netty:netty-codec-xml:4.2.10.Final")
	testImplementation("org.springframework.boot:spring-boot-starter-test")
	testImplementation("org.jetbrains.kotlin:kotlin-test-junit5")
	testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test")
	testRuntimeOnly("org.junit.platform:junit-platform-launcher")
	implementation("org.apache.poi:poi-ooxml:5.3.0")
	// gRPC (netty-shaded bundles its own Netty to avoid conflicts with reactor-netty)
	implementation("io.grpc:grpc-netty-shaded:1.65.0")
	implementation("io.grpc:grpc-protobuf:1.65.0")
	implementation("io.grpc:grpc-stub:1.65.0")
	// JWT
	implementation("io.jsonwebtoken:jjwt-api:0.12.6")
	runtimeOnly("io.jsonwebtoken:jjwt-impl:0.12.6")
	runtimeOnly("io.jsonwebtoken:jjwt-jackson:0.12.6")
}

kotlin {
	compilerOptions {
		freeCompilerArgs.addAll("-Xjsr305=strict", "-Xannotation-default-target=param-property")
	}
}

tasks.withType<Test> {
	useJUnitPlatform()
}

tasks.named<org.springframework.boot.gradle.tasks.run.BootRun>("bootRun") {
	jvmArgs(
		"-Dpolyglot.engine.WarnInterpreterOnly=false",
		"-Xmx2g",
		// Log4j2 all-async mode (LMAX Disruptor ring buffer)
		"-Dlog4j2.contextSelector=org.apache.logging.log4j.core.async.AsyncLoggerContextSelector"
	)
}
