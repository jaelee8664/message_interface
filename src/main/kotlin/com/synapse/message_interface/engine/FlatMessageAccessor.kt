package com.synapse.message_interface.engine

enum class fieldStatus(status: String){
    NOKEY("noKey"),
}

object FlatMessageAccessor {

    /**
     * Get a value from a nested map using dot-notation.
     * Supports list index access: "body.items[0].id"
     */
    @Suppress("UNCHECKED_CAST")
    fun get(map: Map<String, Any?>, key: String): Any? {
        var current: Any? = map
        var path = ""

        for (part in parseParts(key)) {
            // Step 1: resolve named key if current is a map
            if (current is Map<*, *>) {
                val m = current as Map<String, Any?>
                if (!m.containsKey(part.name)) return fieldStatus.NOKEY
                current = m[part.name]
                path = if (path.isEmpty()) part.name else "$path.${part.name}"
            } else if (part.index == null) {
                throw IllegalStateException(
                    "Cannot traverse '${part.name}' on ${current?.javaClass?.simpleName ?: "null"} at '$path' in '$key'"
                )
            }

            // Step 2: resolve list index if specified
            if (part.index != null) {
                val list = current as? List<*>
                    ?: throw IllegalStateException(
                        "Expected List at '${part.name}' but got ${current?.javaClass?.simpleName} in '$key'"
                    )
                if (part.index >= list.size)
                    throw IndexOutOfBoundsException(
                        "Index ${part.index} out of bounds for '${part.name}' (size=${list.size}) in '$key'"
                    )
                current = list[part.index]
                path = "$path[${part.index}]"
            }
        }
        return current
    }

    /**
     * Set a value in a nested map using dot-notation. Modifies the map in-place (creates sub-maps as needed).
     */
    @Suppress("UNCHECKED_CAST")
    fun set(map: MutableMap<String, Any?>, key: String, value: Any?) {
        val parts = parseParts(key)
        if (parts.isEmpty()) return
        if (parts.size == 1) {
            map[parts[0].name] = value
            return
        }
        var current: MutableMap<String, Any?> = map
        for (i in 0 until parts.size - 1) {
            val part = parts[i]
            if (part.index != null) {
                val list = current[part.name] as? List<*> ?: return
                current = list.getOrNull(part.index) as? MutableMap<String, Any?>
                    ?: throw IndexOutOfBoundsException("Index ${part.index} out of bounds for '${part.name}' (size=${list.size})")
            } else {
                val next = current.getOrPut(part.name) { mutableMapOf<String, Any?>() }
                current = next as? MutableMap<String, Any?> ?: run {
                    val newMap = mutableMapOf<String, Any?>()
                    current[part.name] = newMap
                    newMap
                }
            }
        }
        current[parts.last().name] = value
    }

    /**
     * Flatten a nested map to dot-notation entries: {"header": {"time": "x"}} → {"header.time": "x"}
     */
    fun flatten(map: Map<String, Any?>, prefix: String = ""): Map<String, Any?> {
        val result = mutableMapOf<String, Any?>()
        for ((k, v) in map) {
            val fullKey = if (prefix.isEmpty()) k else "$prefix.$k"
            when (v) {
                is Map<*, *> -> result.putAll(flatten(v as Map<String, Any?>, fullKey))
                is List<*> -> {
                    result[fullKey] = v
                    v.forEachIndexed { i, item ->
                        if (item is Map<*, *>) {
                            result.putAll(flatten(item as Map<String, Any?>, "$fullKey[$i]"))
                        }
                    }
                }
                else -> result[fullKey] = v
            }
        }
        return result
    }

    private data class KeyPart(val name: String, val index: Int? = null)

    private fun parseParts(key: String): List<KeyPart> {
        if (key.isEmpty()) throw IllegalArgumentException("Key must not be empty")
        return key.split(".").map { part ->
            if (part.isEmpty()) throw IllegalArgumentException("Invalid key '$key': empty segment (check for leading, trailing, or consecutive dots)")
            val idxMatch = Regex("""^(.+)\[(\d+)\]$""").find(part)
            if (idxMatch != null) {
                KeyPart(idxMatch.groupValues[1], idxMatch.groupValues[2].toInt())
            } else {
                if (part.contains('[') || part.contains(']'))
                    throw IllegalArgumentException("Invalid key segment '$part' in '$key': malformed index notation (expected: name[N])")
                KeyPart(part)
            }
        }
    }
}
