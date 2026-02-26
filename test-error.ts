/**
 * Test file - all errors fixed
 */

// Fixed 1: Assign number to number type
const num: number = 42;

// Fixed 2: num is not callable, use it as a number
const result = num * 2;

// Fixed 3: Access existing property
const obj = { name: "test" };
const missing = obj.name;

// Fixed 4: Use the variable to avoid unused warning
const unusedVar = 123;
console.log(unusedVar);

// Fixed 5: Provide all required arguments
function greet(name: string, age: number): string {
  return `Hello ${name}, you are ${age}`;
}

greet("John", 25);

// Fixed 6: Removed non-existent module import

export { result, missing, greet };
