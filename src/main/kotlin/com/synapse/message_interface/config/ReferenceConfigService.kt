package com.synapse.message_interface.config

import org.slf4j.LoggerFactory
import org.springframework.core.io.ResourceLoader
import org.springframework.stereotype.Service
import org.yaml.snakeyaml.Yaml
import java.io.File

@Service
class ReferenceConfigService(private val resourceLoader: ResourceLoader) {
    private val log = LoggerFactory.getLogger(javaClass)

    // 외부 경로(프로젝트 루트 / JAR 옆): 읽기·쓰기 가능
    private val referenceFile = File("reference.yaml")

    init {
        // 외부 파일이 없으면 클래스패스의 기본값을 복사
        if (!referenceFile.exists()) {
            runCatching {
                val classpath = resourceLoader.getResource("classpath:reference.yaml")
                if (classpath.exists()) {
                    referenceFile.writeText(classpath.inputStream.bufferedReader().readText())
                    log.info("[ReferenceConfig] 기본 reference.yaml을 ${referenceFile.absolutePath}로 복사했습니다.")
                }
            }.onFailure {
                log.warn("[ReferenceConfig] 기본 reference.yaml 복사 실패: ${it.message}")
            }
        }
    }

    @Suppress("UNCHECKED_CAST")
    fun getConfig(): Map<String, Any?> {
        if (!referenceFile.exists()) return emptyMap()
        return Yaml().load(referenceFile.readText()) as? Map<String, Any?> ?: emptyMap()
    }

    fun saveConfig(data: Map<String, Any?>) {
        referenceFile.writeText(Yaml().dump(data))
    }

    @Suppress("UNCHECKED_CAST")
    fun getEditPassword(): String {
        val workflow = getConfig()["workflow"] as? Map<*, *>
        return workflow?.get("editPassword") as? String
            ?: System.getenv("WORKFLOW_EDIT_PASSWORD")
            ?: "admin"
    }

}
