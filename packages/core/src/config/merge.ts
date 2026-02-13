import { mergeDeep as remedaMergeDeep } from "remeda";

export function mergeDeep<T extends object>(target: T, source: Partial<T>): T {
  // remeda.mergeDeep 实现深合并
  // - 对象字段递归合并
  // - 数组字段默认替换（可配置为追加）
  return remedaMergeDeep(target, source) as T;
}

export function mergeWithArrayConcat<T>(
  target: T,
  source: Partial<T>,
  arrayFields: string[]
): T {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const targetValue = (result as Record<string, unknown>)[key];
    const sourceValue = (source as Record<string, unknown>)[key];

    if (arrayFields.includes(key) && Array.isArray(targetValue) && Array.isArray(sourceValue)) {
      (result as Record<string, unknown>)[key] = [...targetValue, ...sourceValue];
    } else if (typeof targetValue === "object" && typeof sourceValue === "object" && targetValue !== null && sourceValue !== null) {
      (result as Record<string, unknown>)[key] = mergeWithArrayConcat(
        targetValue as T,
        sourceValue as Partial<T>,
        arrayFields
      );
    } else {
      (result as Record<string, unknown>)[key] = sourceValue;
    }
  }
  return result;
}
