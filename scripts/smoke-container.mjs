import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
let calls = 0;
const server = http.createServer(async (req,res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(403); res.end('Blocked in test'); return; }
  let body=''; for await (const chunk of req) body+=chunk;
  const data=JSON.parse(body); calls++; console.log('MODEL_REQUEST', JSON.stringify({stream:data.stream,tools:data.tools?.length}));
  const hasToolResult=data.messages?.some(m=>m.role==='tool');
  const tool=data.tools?.find(t=>t.function.name==='bash');
  // OpenCode may also request a session title without tools.
  const delta=(hasToolResult || !tool) ? {content:'Created smoke.txt'} : {tool_calls:[{index:0,id:'call_smoke',type:'function',function:{name:tool.function.name,arguments:JSON.stringify({command:'pwd; printf verified > smoke.txt',description:'Create smoke verification file'})}}]};
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write('data: '+JSON.stringify({id:'smoke',object:'chat.completion.chunk',created:1,model:'test-coder',choices:[{index:0,delta:{role:'assistant',...delta},finish_reason:null}]})+'\n\n');
  res.write('data: '+JSON.stringify({id:'smoke',object:'chat.completion.chunk',created:1,model:'test-coder',choices:[{index:0,delta:{},finish_reason:(hasToolResult || !tool)?'stop':'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}})+'\n\n');
  res.end('data: [DONE]\n\n');
});
server.on('connect', (req, socket) => { socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'); });
await new Promise(r=>server.listen(8788,'127.0.0.1',r));
const baseURL='http://127.0.0.1:8788/v1';
try {
for (const agent of (process.env.SMOKE_AGENT ? [process.env.SMOKE_AGENT] : ['pi','opencode'])) {
  const cwd='/tmp/smoke-'+agent; await mkdir(cwd,{recursive:true});
  spawnSync('git', ['init'], { cwd });
  const piDir='/tmp/pi-config'; await mkdir(piDir,{recursive:true});
  await writeFile(piDir+'/models.json',JSON.stringify({providers:{custom:{baseUrl:baseURL,api:'openai-completions',apiKey:'placeholder',models:[{id:'test-coder',contextWindow:32768,maxTokens:4096}]}}}));
  const config={enabled_providers:['custom'],provider:{custom:{npm:'@ai-sdk/openai-compatible',name:'Custom',options:{baseURL,apiKey:'placeholder'},models:{'test-coder':{name:'Test',limit:{context:32768,output:4096}}}}}};
  const env={...process.env,PWD:cwd,HTTP_PROXY:"http://127.0.0.1:8788",HTTPS_PROXY:"http://127.0.0.1:8788",NO_PROXY:"localhost,127.0.0.1",PI_CODING_AGENT_DIR:piDir,PI_OFFLINE:'1',PI_SKIP_VERSION_CHECK:'1',PI_TELEMETRY:'0',OPENCODE_CONFIG_CONTENT:JSON.stringify(config),OPENCODE_DISABLE_MODELS_FETCH:'1',OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_DISABLE_DEFAULT_PLUGINS:'1',OPENCODE_DISABLE_LSP_DOWNLOAD:'1',OPENCODE_DISABLE_SHARE:'1'};
  const args=agent==='pi'?['--mode','json','--no-session','--provider','custom','--model','test-coder','--','Create smoke.txt']:['/opt/opencode-task.mjs','test-coder','Create smoke.txt'];
  let toolsObserved = 0;
  let pendingOutput = '';
  const code=await new Promise(resolve=>{const child=spawn(agent==='opencode'?'node':agent,args,{cwd,env,stdio:['ignore','pipe','pipe'],timeout:60000}); child.stdout.on('data',d=>{ pendingOutput += d.toString(); const lines = pendingOutput.split('\n'); pendingOutput = lines.pop() || ''; for (const line of lines) { try { const e=JSON.parse(line); if(e.type === 'tool_execution_start') toolsObserved++; if(['tool_use','tool_execution_start','tool_execution_end','text','error','agent_settled'].includes(e.type)) console.log(line); } catch {} } });child.stderr.on('data',d=>process.stderr.write(d));child.on('exit',resolve);});
  if(code!==0)throw new Error(agent+' exited '+code);
  if(await readFile(cwd+'/smoke.txt','utf8')!=='verified')throw new Error(agent+' did not execute bash');
  if (agent === 'opencode' && toolsObserved === 0) throw new Error('OpenCode did not stream tool events');
  console.log('SMOKE PASSED: '+agent);
}
console.log('MODEL REQUESTS: '+calls);
} finally {server.close();}
