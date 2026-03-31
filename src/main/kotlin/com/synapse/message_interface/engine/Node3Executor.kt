package com.synapse.message_interface.engine

import com.synapse.message_interface.domain.FieldType
import com.synapse.message_interface.domain.node.DtoMapping
import com.synapse.message_interface.domain.node.ItemFieldMapping
import com.synapse.message_interface.domain.node.ListAddItem
import com.synapse.message_interface.domain.node.ListAddItemType
import com.synapse.message_interface.domain.node.Node3Definition
import com.synapse.message_interface.script.JavaScriptExecutor
import org.springframework.stereotype.Component

@Component
class Node3Executor(private val scriptExecutor: JavaScriptExecutor) {

    /**
     * Map input DTO to output DTO using Node3 mappings.
     * Returns a new map with only the mapped keys.
     *
     * List operations per mapping:
     * - filterCode: JS expression evaluated per item.
     *     Context always includes flattened outer DTO fields (input data).
     *     List<Map>       → item fields exposed under "el." prefix (e.g. el.id, el.qty)
     *     List<primitive> → item exposed as 'el'
     *     List<List>      → nested lists are unsupported; items are dropped (always false)
     * - listAddItems: appended after filtering; supports FIXED literals or FIELD_REF references into input data.
     *     Each item may have an optional addCondition (JS expression against flat outer DTO); false = skip append.
     */
    @Suppress("UNCHECKED_CAST")
    suspend fun execute(data: Map<String, Any?>, definition: Node3Definition): MutableMap<String, Any?> {
        val result = mutableMapOf<String, Any?>()

        for (mapping in definition.mappings) {
            val value = FlatMessageAccessor.get(data, mapping.beforeKey)
            val finalValue = applyListOps(value, mapping, data)
            FlatMessageAccessor.set(result, mapping.newKey, finalValue)
        }

        return result
    }

    @Suppress("UNCHECKED_CAST")
    private suspend fun applyListOps(value: Any?, mapping: DtoMapping, data: Map<String, Any?>): Any? {
        if (value !is List<*> || (mapping.filterCode.isNullOrBlank() && mapping.listAddItems.isNullOrEmpty() && mapping.itemMappings.isNullOrEmpty())) return value

        var list: List<Any?> = value

        val needsFlatData = !mapping.filterCode.isNullOrBlank()
                || mapping.listAddItems?.any { it.addCondition != null || it.type == ListAddItemType.EXPR } == true
        val flatData = if (needsFlatData) FlatMessageAccessor.flatten(data) else emptyMap()

        // Filter — varsBuf is allocated once and mutated per item to avoid per-item Map allocation.
        // currentElKeys tracks only the keys added for the current item so that only those are
        // removed on the next iteration (preserving any "el.*" keys that may exist in flatData).
        if (!mapping.filterCode.isNullOrBlank()) {
            val varsBuf = flatData.toMutableMap()
            val currentElKeys = mutableSetOf<String>()
            list = list.filter { item ->
                try {
                    evalFilter(item, mapping.filterCode, varsBuf, currentElKeys)
                } catch (e: Exception) {
                    throw RuntimeException("Node3 filterCode 실행 오류 (mapping: ${mapping.beforeKey} → ${mapping.newKey}): ${e.message}", e)
                }
            }
        }

        // Item field remapping: transform each element's fields
        if (!mapping.itemMappings.isNullOrEmpty()) {
            list = list.map { item -> applyItemMappings(item, mapping.itemMappings) }
        }

        // Prepend / Append
        if (!mapping.listAddItems.isNullOrEmpty()) {
            val prepends = mutableListOf<Any?>()
            val appends = mutableListOf<Any?>()
            for (addItem in mapping.listAddItems) {
                if (!addItem.addCondition.isNullOrBlank()) {
                    val pass = try {
                        scriptExecutor.executeTemplate(addItem.addCondition, flatData) as? Boolean ?: false
                    } catch (e: Exception) {
                        throw RuntimeException("Node3 listAddItem addCondition 실행 오류 (mapping: ${mapping.beforeKey} → ${mapping.newKey}): ${e.message}", e)
                    }
                    if (!pass) continue
                }
                val resolved = try {
                    resolveAddItem(addItem, data, flatData)
                } catch (e: Exception) {
                    throw RuntimeException("Node3 listAddItem EXPR 실행 오류 (mapping: ${mapping.beforeKey} → ${mapping.newKey}): ${e.message}", e)
                }
                val mappedResolved = if (!mapping.itemMappings.isNullOrEmpty()) applyItemMappings(resolved, mapping.itemMappings) else resolved
                if (addItem.prepend) prepends.add(mappedResolved) else appends.add(mappedResolved)
            }
            list = prepends + list + appends
        }

        return list
    }

    @Suppress("UNCHECKED_CAST")
    private fun applyItemMappings(item: Any?, itemMappings: List<ItemFieldMapping>): Any? {
        if (item !is Map<*, *>) return item
        val src = item as Map<String, Any?>
        val newItem = mutableMapOf<String, Any?>()
        for (m in itemMappings) {
            val v = FlatMessageAccessor.get(src, m.beforeKey)
            FlatMessageAccessor.set(newItem, m.newKey, v)
        }
        return newItem
    }

    /**
     * Evaluate filterCode for a single list item.
     * [varsBuf] is a mutable map pre-filled with the outer DTO's flat fields.
     * [currentElKeys] tracks keys added for the previous item; only those are removed
     * before adding the current item's keys — flatData keys are never touched.
     */
    @Suppress("UNCHECKED_CAST")
    private suspend fun evalFilter(
        item: Any?,
        filterCode: String,
        varsBuf: MutableMap<String, Any?>,
        currentElKeys: MutableSet<String>
    ): Boolean {
        // Remove only keys that were added for the previous item (not flatData keys)
        currentElKeys.forEach { varsBuf.remove(it) }
        currentElKeys.clear()

        return when {
            item is Map<*, *> -> {
                // item fields exposed under "el." prefix to avoid collision with outer DTO fields
                val flatItem = FlatMessageAccessor.flatten(item as Map<String, Any?>, "el")
                flatItem.forEach { (k, v) -> varsBuf[k] = v }
                currentElKeys.addAll(flatItem.keys)
                validateFilterKeys(filterCode, varsBuf)
                scriptExecutor.executeTemplate(filterCode, varsBuf) as? Boolean ?: false
            }
            item is List<*> -> false  // nested list: unsupported, always dropped
            else -> {
                // primitive: exposed as 'el', outer DTO fields also available
                varsBuf["el"] = item
                currentElKeys.add("el")
                validateFilterKeys(filterCode, varsBuf)
                scriptExecutor.executeTemplate(filterCode, varsBuf) as? Boolean ?: false
            }
        }
    }

    private fun validateFilterKeys(filterCode: String, vars: Map<String, Any?>) {
        val missing = PLACEHOLDER_REGEX.findAll(filterCode)
            .map { it.groupValues[1] }
            .filter { !vars.containsKey(it) }
            .toList()
        if (missing.isNotEmpty())
            throw IllegalArgumentException(
                "Filter code references unknown keys: [${missing.joinToString()}]. " +
                "Available keys: [${vars.keys.sorted().joinToString()}]"
            )
    }

    companion object {
        private val PLACEHOLDER_REGEX = Regex("""\{\$([^}]+)\}""")
    }

    private suspend fun resolveAddItem(addItem: ListAddItem, data: Map<String, Any?>, flatData: Map<String, Any?>): Any? {
        return when (addItem.type) {
            ListAddItemType.FIXED -> parseFixedValue(addItem.fixedValue, addItem.fixedType)
            ListAddItemType.FIELD_REF -> FlatMessageAccessor.get(data, addItem.fieldRef!!)
            ListAddItemType.EXPR -> scriptExecutor.executeTemplate(addItem.expr!!, flatData)
        }
    }

    private fun parseFixedValue(raw: String?, type: FieldType?): Any? {
        if (raw == null || type == null) return null
        return when (type) {
            FieldType.STRING -> raw
            FieldType.INT -> raw.toInt()
            FieldType.DOUBLE -> raw.toDouble()
            FieldType.BOOLEAN -> raw.toBooleanStrict()
            else -> raw
        }
    }
}
