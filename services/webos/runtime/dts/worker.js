let compiled=null;
const run=async(base,path,g,downmix,format,follow)=>{
 let core,waitMs=0,reads=0,writes=0,inputBytes=0,outputBytes=0;
 try{
 importScripts(base+'/audio-transcode/assets/ffmpeg-core.js');
 const options={mainScriptUrlOrBlob:base+'/audio-transcode/assets/ffmpeg-core.js#'+btoa(JSON.stringify({wasmURL:base+'/audio-transcode/assets/ffmpeg-core.wasm'}))};
 // follow: one worker serves every generation, so compile the module once.
 if(follow){if(!compiled)compiled=await WebAssembly.compile(await (await fetch(base+'/audio-transcode/assets/ffmpeg-core.wasm')).arrayBuffer());options.instantiateWasm=(imports,done)=>{WebAssembly.instantiate(compiled,imports).then((instance)=>done(instance,compiled));return{}}}
 core=await createFFmpegCore(options);const logs=[];core.setLogger(({message})=>{logs.push(message);if(logs.length>8)logs.shift()});
 const inputDev=core.FS.makedev(64,0),outputDev=core.FS.makedev(64,1);let chunk=new Uint8Array(0),cursor=0,eof=false;
 const request=(method,route,body)=>{const xhr=new XMLHttpRequest();xhr.open(method,base+path+route,false);xhr.responseType='arraybuffer';xhr.timeout=0;const ioStart=performance.now();xhr.send(body);waitMs+=performance.now()-ioStart;if(xhr.status<200||xhr.status>=300)throw Error('io-'+xhr.status);return new Uint8Array(xhr.response||new ArrayBuffer(0))};
 core.FS.registerDevice(inputDev,{open(s){s.seekable=false},read(s,b,o,n){if(cursor===chunk.length&&!eof){chunk=request('GET','/input?g='+g);cursor=0;reads++;eof=chunk.length===0;}const len=Math.min(n,chunk.length-cursor);b.set(chunk.subarray(cursor,cursor+len),o);cursor+=len;inputBytes+=len;return len;}});
 let execStart=0,lastProgress=0;let outputBatch=new Uint8Array(65536),outputLength=0;const flush=()=>{if(outputLength){request('POST','/output?g='+g,outputBatch.subarray(0,outputLength));writes++;outputLength=0;const now=performance.now();if(outputBytes>=160000&&(now-execStart-waitMs)/(outputBytes/80)>0.65)throw Error('cpu-budget');if(now-lastProgress>500){postMessage({type:'progress',inputBytes,outputBytes,heap:core.HEAPU8.length});lastProgress=now;}}};core.FS.registerDevice(outputDev,{open(s){s.seekable=false},write(s,b,o,n){if(outputLength+n>outputBatch.length)flush();outputBatch.set(b.subarray(o,o+n),outputLength);outputLength+=n;outputBytes+=n;if(outputLength>=65536)flush();return n;}});
 core.FS.mkdev('/input',438,inputDev);core.FS.mkdev('/output',438,outputDev);core.reset();core.setTimeout(-1);const start=performance.now();execStart=start;postMessage({type:'ready',heap:core.HEAPU8.length});
 const ret=core.exec('-xerror','-err_detect','explode','-y','-hide_banner','-loglevel','error','-threads','1','-probesize','65536','-analyzeduration','100000',...(downmix?['-downmix','5.1(side)']:[]),'-f',format==='truehd'?'truehd':'dts','-i','/input',...(downmix?['-ac','6','-af','aresample=rematrix_maxval=1']:[]),'-ar','48000','-c:a','ac3','-b:a','640k','-flush_packets','1','-f','ac3','/output');
 flush();return{ret,ms:performance.now()-start,reads,writes,inputBytes,outputBytes,heap:core.HEAPU8.length,logs};
 }catch(e){return{error:String(e),superseded:String(e)==='Error: io-409',reads,writes,inputBytes,outputBytes}}
};
// Tizen AVPlay blocks the page while it seeks, so the page cannot start the
// worker of the next generation; with follow the worker reads it itself.
const nextGeneration=async(base,path,g)=>{
 for(const until=performance.now()+60000;performance.now()<until;){const xhr=new XMLHttpRequest();xhr.open('GET',base+path+'/control',false);xhr.send();if(xhr.status!==200)return 0;const next=Number(JSON.parse(xhr.responseText).g)||0;if(next&&next!==g)return next;await new Promise((r)=>setTimeout(r,100))}
 return 0;
};
onmessage=async({data:{base,path,g,downmix=false,format="dts",follow=false}})=>{
 for(;;){const result=await run(base,path,g,downmix,format,follow);if(!follow||!result.superseded)return postMessage(result);const next=await nextGeneration(base,path,g).catch(()=>0);if(!next)return postMessage(result);g=next;postMessage({type:'generation',g})}
};
