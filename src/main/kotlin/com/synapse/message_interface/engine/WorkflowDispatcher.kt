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
     */
    suspend fun dispatch(context: MessageContext, format: MessageFormat = MessageFormat.JSON): PipelineResult {
        // Try to parse to get field values for condition matching
        val messageFields: Map<String, String?> = try {
            val parsed = parserRegistry.getParser(format).parse(context.rawBytes)
            FlatMessageAccessor.flatten(parsed).mapValues { it.value?.toString() }
        } catch (e: Exception) {
            emptyMap()
        }

        val unit = registry.getAll().find { unit ->
            conditionEvaluator.matches(unit.condition, context.endpoint, messageFields)
        } ?: throw NoMatchingWorkflowException(
            "수신된 메세지에 일치하는 워크플로우 단위가 없습니다. endpoint=${context.endpoint}"
        )

        return pipeline.execute(context, unit)
    }
}
