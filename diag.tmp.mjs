const p = "C:\smoke\a.txt"; // string real: C:\smoke\a.txt
console.log("string:", p);
console.log("regex1:", /^[a-z]:\/i.test(p));
console.log("startsWithUNC:", p.startsWith("\\\\"));
