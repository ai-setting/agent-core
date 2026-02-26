// Test file with errors for LSP diagnostics

function greet(name: string): string {
    return "Hello, " + name;
}

// Fixed 1: Type correct - assigning string to string
const str: string = "this is a string";

// Fixed 2: Defined the variable
const undefinedVariable = "defined now";
console.log(undefinedVariable);

// Fixed 3: Pass argument
greet("World");

// Fixed 4: Syntax - removed trailing comma
const obj = { a: 1, b: 2 };

export { greet };
