package com.synapse.message_interface.engine

/**
 * Result returned by the message pipeline after processing a workflow unit.
 *
 * Reception handlers use this to construct the protocol-specific response:
 * - [body]       → response payload bytes (null or empty = no body)
 * - [httpStatus] → HTTP status code (used by REST handler; other protocols ignore)
 * - [isSuccess]  → used by gRPC handler to set the success flag in MessageResponse
 */
data class PipelineResult(
    val body: ByteArray?,
    val httpStatus: Int = 200,
    val isSuccess: Boolean = true,
    val outputMap: Map<String, Any?>? = null,
    val unitId: String? = null
)
