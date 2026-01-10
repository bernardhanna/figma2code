import fs from "fs";
import path from "path";
let RULES=null;
export function learnedRulesPass(ast){
  if(!RULES){
    const p = path.resolve("generator/learn/rules.json");
    RULES = fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")).rules:[];
  }
  function walk(n){
    if(!n||!n.classes) return;
    for(const r of RULES){
      if(n.classes.includes(r.when.class)){
        n.classes = n.classes.map(c=>c===r.when.class?r.then.replace:c);
      }
    }
    (n.children||[]).forEach(walk);
  }
  walk(ast.tree||ast);
  return ast;
}
