package com.synapse.message_interface.api.dto

data class FilterConditionDto(
    val key: String = "",
    val value: String = ""
)

data class TraceSearchRequest(
    val filterGroups: List<List<FilterConditionDto>> = emptyList(),
    val fromDate: String? = null,
    val toDate: String? = null,
    val fromFiles: Boolean = true,
    val days: Int = 7,
    val maxTraces: Int = 50
)
