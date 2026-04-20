const RE_COT_BLOCK = /\*\*(?:Identifying|Conducting|Confirming|Formatting|Analyzing|Researching|Verifying|Processing|Evaluating|Examining)[^*]*\*\*\s*[^]*?(?=\*\*[A-Z]|\n\n(?=[A-Z])|\n*$)/g;
const text = "**Identifying a random image...** I found an image: ![image](/Users/yamato/Pictures/Anime:Manga:JP\\ video\\ Game\\ Art/1753554867571619.jpg)";
console.log("Input:", text);
console.log("Sanitized:", text.replace(RE_COT_BLOCK, '').trim());
