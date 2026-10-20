// PROJECT-WIDE: every `check-*` a comment cites must be a guard that exists.
// Line-wrapped names are rejoined before checking, or a wrap reads as a missing file.
const fs=require("fs"), cp=require("child_process");
const files=cp.execSync("ls features/*.js backends/backend1/*.js ui/*.js core/*.js tests/*.js tools/*.js 2>/dev/null",{encoding:"utf8"}).trim().split("\n");
const have=new Set(fs.readdirSync("tests").filter(x=>x.startsWith("check-")).map(x=>x.replace(/\.js$/,"")));
const missing=new Map(); let total=0;
for(const f of files){
  const lines=fs.readFileSync(f,"utf8").split("\n");
  for(let i=0;i<lines.length;i++){
    if(!lines[i].trim().startsWith("//")) continue;
    // rejoin a name split across a comment line break
    let text=lines[i];
    if(/check-[a-z0-9-]*-$/.test(text.trim()) && lines[i+1] && lines[i+1].trim().startsWith("//")){
      text += lines[i+1].replace(/^\s*\/\/\s?/,"");
    }
    for(const m of (text.match(/check-[a-z0-9]+(?:-[a-z0-9]+)*/g)||[])){
      total++;
      if(!have.has(m)){ if(!missing.has(m)) missing.set(m,[]); missing.get(m).push(f.split("/").pop()+":"+(i+1)); }
    }
  }
}
console.log("citations: "+total+"   distinct unresolved: "+missing.size);
for(const [g,where] of [...missing].sort()) console.log("  "+g.padEnd(26)+where.slice(0,3).join(", "));
