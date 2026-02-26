// 测试 LSP 诊断的 TypeScript 文件
// 包含明显的语法错误

// 错误1: 类型声明错误 - 字符串赋值给number类型
const num: number = "hello";

// 错误2: 缺少参数类型注解
function greet(name) {
  return "Hello, " + name;
}

// 错误3: 使用未定义的变量
console.log(undefinedVariable);

// 错误4: 对象属性访问错误
const obj = { a: 1 };
console.log(obj.b.c);

// 错误5: 函数调用参数数量不匹配
function add(a: number, b: number): number {
  return a + b;
}
add(1);

// 错误6: 数组类型不匹配
const arr: number[] = ["a", "b", "c"];

// 错误7: 接口属性缺失
interface User {
  name: string;
  age: number;
}
const user: User = { name: "Tom" };

// 错误8: 类型断言错误
const value: any = "123";
const numValue: number = value;
