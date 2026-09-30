import fs from "node:fs";
import path from "node:path";

const root=path.resolve(process.argv[2] ?? "plugins/mado-system-one-reviewer");
const errors=[];
const warnings=[];
const p=(x)=>path.join(root,x);
const exists=(x)=>fs.existsSync(p(x));
const read=(x)=>fs.readFileSync(p(x),"utf8");
const json=(x)=>{try{return JSON.parse(read(x));}catch(e){errors.push(`${x}: invalid JSON: ${e.message}`);return null;}};
const oneLine=(v)=>typeof v==="string" && !/[\r\n]/.test(v);
const norm=(v)=>v.normalize("NFKC").replace(/\s+/g," ").trim();
const fail=(m)=>errors.push(m);

if(!exists("plugin.json")) fail("plugin.json is required");
const m=exists("plugin.json")?json("plugin.json"):null;

if(m){
  if(m.$schema!=="https://agent-plugins.org/schemas/1.0.0/plugin.schema.json") fail("unsupported plugin schema");
  if(typeof m.name!=="string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(m.name)) fail("invalid plugin name");
  if(typeof m.version!=="string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(m.version)) fail("version must be semver");
  const ui=m.extensions?.["com.openai"]?.interface;
  if(!ui) fail("extensions.com.openai.interface is required");
  else {
    for(const [k,max] of [["displayName",30],["shortDescription",30],["developerName",80]]){
      if(!oneLine(ui[k]) || norm(ui[k]).length===0 || ui[k].length>max) fail(`${k} must be non-empty, one line, <= ${max}`);
    }
    if(typeof ui.longDescription!=="string" || norm(ui.longDescription).length===0 || ui.longDescription.length>4000) fail("longDescription must be 1-4000 chars");
    const cats=new Set(["Productivity","Creativity","Developer Tools","Business & Operations","Data & Analytics","Communication","Education & Research","Security","Finance","Healthcare","Travel","Entertainment","Other"]);
    if(!cats.has(ui.category)) fail("unsupported category");
    if(!Array.isArray(ui.capabilities) || ui.capabilities.length<1 || ui.capabilities.length>20) fail("capabilities must contain 1-20 entries");
    else ui.capabilities.forEach((v,i)=>{if(!oneLine(v)||norm(v).length===0||v.length>120) fail(`invalid capability ${i}`);});
    if(!Array.isArray(ui.defaultPrompt) || ui.defaultPrompt.length<1 || ui.defaultPrompt.length>3) fail("defaultPrompt must contain 1-3 prompts");
    else {
      const seen=new Set();
      ui.defaultPrompt.forEach((v,i)=>{
        if(!oneLine(v)||norm(v).length===0||v.length>128) fail(`invalid starter prompt ${i}`);
        if(v.includes("@")) fail(`starter prompt ${i} contains @mention`);
        const key=norm(v); if(seen.has(key)) fail(`duplicate starter prompt ${i}`); seen.add(key);
      });
    }
    if(m.author?.name && m.author.name!==ui.developerName) fail("author.name must match developerName");
    if(ui.screenshots!==undefined) fail("skills-only fixture must not declare screenshots");
  }
}

for(const x of ["mcp.json",".mcp.json",".app.json"]) if(exists(x)) fail(`skills-only fixture must not contain ${x}`);

const skillPath="skills/decision-review/SKILL.md";
if(!exists(skillPath)) fail(`${skillPath} is required`);
else {
  const s=read(skillPath);
  const fm=s.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if(!fm) fail("SKILL.md needs front matter and body");
  else {
    const name=fm[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const desc=fm[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
    if(!name) fail("skill name is required");
    if(!desc || desc.length>1024) fail("skill description must be 1-1024 chars");
    if(!fm[2].trim()) fail("skill body is empty");
    if(m?.name && name && `${m.name}:${name}`.length>64) fail("combined plugin:skill identity exceeds 64 chars");
  }
}

for(const x of ["review/submission.json","review/positive.json","review/negative.json","review/PUBLISHER_CHECKLIST.md"]) if(!exists(x)) fail(`${x} is required`);

const sub=exists("review/submission.json")?json("review/submission.json"):null;
const pos=exists("review/positive.json")?json("review/positive.json"):null;
const neg=exists("review/negative.json")?json("review/negative.json"):null;

if(sub&&m){
  if(sub.submissionType!=="skills_only") fail("submissionType must be skills_only");
  if(sub.package!==m.name || sub.version!==m.version) fail("submission package/version must match manifest");
  if(sub.publisherIdentityStatus?.startsWith("HUMAN_GATE")) warnings.push("publisher identity requires human verification");
  if(sub.logoStatus?.startsWith("HUMAN_GATE")) warnings.push("production logo is a human gate");
  if(sub.availabilityStatus?.startsWith("HUMAN_GATE")) warnings.push("availability is a human gate");
}

if(!Array.isArray(pos)||pos.length!==5) fail("positive.json must contain exactly 5 fixtures");
else pos.forEach((t,i)=>{if(!t.id||!t.prompt||t.expectedActivation!==true||!Array.isArray(t.expectedBehavior)||!t.expectedResultShape||!t.fixtureData) fail(`positive fixture ${i+1} is incomplete`);});

if(!Array.isArray(neg)||neg.length!==3) fail("negative.json must contain exactly 3 fixtures");
else neg.forEach((t,i)=>{if(!t.id||!t.prompt||t.expectedActivation!==false||!t.expectedFallback||!t.reason) fail(`negative fixture ${i+1} is incomplete`);});

warnings.forEach((w)=>console.warn("WARN:",w));
if(errors.length){errors.forEach((e)=>console.error("ERROR:",e));console.error(`Plugin release contract failed: ${errors.length} error(s)`);process.exit(1);}
console.log(`Plugin release contract OK: ${m.name}@${m.version}`);
console.log("Fixtures: 5 positive / 3 negative");
console.log("Mode: skills-only");
