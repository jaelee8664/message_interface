package com.synapse.message_interface.engine

import com.synapse.message_interface.workflow.WorkflowConditionEvaluator
import com.synapse.message_interface.workflow.WorkflowRegistry
import com.synapse.message_interface.parser.MessageParserRegistry
import com.synapse.message_interface.domain.MessageFormat
import org.springframework.stereotype.Component

class NoMatchingWorkflowException(message: String) : RuntimeException(message)

@Component
class WorkflowDispatcher(
    private val registry: WorkflowRegistry,
    private val conditionEvaluator: WorkflowConditionEvaluator,
    private val pipeline: MessagePipeline,
    private val parserRegistry: MessageParserRegistry
) {

    /**
     * Given an incoming message context, find the matching workflow unit and execute the pipeline.
     *
     * gRPC / 기타 pre-parsed 메시지: context.parsedMessage 가 이미 설정되어 있으면
     * parser 호출을 생략하고 해당 Map 을 조건 평가와 NODE1 에 직접 사용한다.
     */
    suspend fun dispatch(context: MessageContext, format: MessageFormat = MessageFormat.JSON): PipelineResult {
        // context.parsedMessage 가 있으면 파싱 생략 (gRPC DynamicMessage 변환 결과 등)
        var preParsed: MutableMap<String, Any?>? = context.parsedMessage
        val messageFields: Map<String, String?> = if (preParsed != null) {
            FlatMessageAccessor.flatten(preParsed).mapValues { it.value?.toString() }
        } else {
            try {
                val parsed = parserRegistry.getParser(format).parse(context.rawBytes).toMutableMap()
                preParsed = parsed
                FlatMessageAccessor.flatten(parsed).mapValues { it.value?.toString() }
            } catch (e: Exception) {
                emptyMap()
            }
        }

        val (exactEndpointIndex, wildcardEndpointUnits, compositeExactEndpointIndex, compositeWildcardEndpointUnits, noEndpointUnits) =
            registry.getIndexedByProtocol(context.protocol) ?: registry.getIndexed()

        val unit =
            // 1. exact ENDPOINT → O(1)
            (if (context.endpoint != null) exactEndpointIndex[context.endpoint] else null)
            // 2. wildcard ENDPOINT → O(k), stops at first match
            ?: wildcardEndpointUnits.firstOrNull { conditionEvaluator.matches(it.condition, context.endpoint, messageFields) }
            // 3. composite with required exact ENDPOINT in AND chain → O(1) lookup + O(j) scan within group
            ?: (if (context.endpoint != null) compositeExactEndpointIndex[context.endpoint] else null)
                ?.firstOrNull { conditionEvaluator.matches(it.condition, context.endpoint, messageFields) }
            // 4. composite with required wildcard ENDPOINT in AND chain → O(w)
            ?: compositeWildcardEndpointUnits.firstOrNull { conditionEvaluator.matches(it.condition, context.endpoint, messageFields) }
            // 5. no indexable endpoint (FIELD_VALUE, CONTAINS_KEY, OR composites) → O(n)
            ?: noEndpointUnits.firstOrNull { conditionEvaluator.matches(it.condition, context.endpoint, messageFields) }
            ?: throw NoMatchingWorkflowException(
                "수신된 메세지에 일치하는 워크플로우 단위가 없습니다. endpoint=${context.endpoint}"
            )

        val enrichedContext = if (preParsed != null) context.copy(parsedMessage = preParsed) else context
        return pipeline.execute(enrichedContext, unit).copy(unitId = unit.id)
    }
}
