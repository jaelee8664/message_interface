package com.synapse.message_interface.api.dto

data class ApiResponse<T>(
    val success: Boolean,
    val data: T? = null,
    val error: String? = null
) {
    companion object {
        fun <T> ok(data: T) = ApiResponse(true, data)
        fun error(message: String) = ApiResponse<Any?>(false, error = message)
    }
}
