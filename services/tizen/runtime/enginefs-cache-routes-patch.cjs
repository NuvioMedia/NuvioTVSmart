/* Adds torrent cache endpoints to the vendored EngineFS router. ES5 for TV runtimes. */
module.exports = function patchEngineFsCacheRoutes(source) {
  var code = String(source || "");
  if (code.indexOf("/* NUVIO_CACHE_ROUTES */") !== -1) {
    return code;
  }
  var target = 'enginefs.router.get("/settings"';
  if (code.indexOf(target) === -1) {
    return code;
  }

  var routes = [
    "/* NUVIO_CACHE_ROUTES */",
    "(function(){",
    "function nuvioCacheEntries(){",
    "var entries=[];",
    "try{entries=fs.readdirSync(os.tmpdir())}catch(e){return entries}",
    'return entries.filter(function(name){return /^[0-9a-f]{40}$/i.test(String(name||""))})',
    "}",
    "function nuvioCacheActive(){",
    "var active={};",
    "try{(enginefs.list?enginefs.list():[]).forEach(function(hash){active[String(hash||'').toLowerCase()]=1})}catch(e){}",
    "return active;",
    "}",
    "function nuvioCacheSize(target){",
    "var total=0,stack=[target];",
    "while(stack.length){",
    "var current=stack.pop(),info=null;",
    "try{info=fs.lstatSync(current)}catch(e){continue}",
    "if(info.isSymbolicLink())continue;",
    "if(info.isDirectory()){",
    "var kids=[];",
    "try{kids=fs.readdirSync(current)}catch(e){continue}",
    "for(var i=0;i<kids.length;i++)stack.push(path.join(current,kids[i]));",
    "}else if(info.isFile()){total+=info.size}",
    "}",
    "return total;",
    "}",
    "function nuvioCacheDelete(target){",
    "var info=null,reclaimed=0;",
    "try{info=fs.lstatSync(target)}catch(e){return 0}",
    "if(info.isSymbolicLink()){try{fs.unlinkSync(target)}catch(e){}return 0}",
    "if(info.isDirectory()){",
    "var kids=[];",
    "try{kids=fs.readdirSync(target)}catch(e){}",
    "for(var i=0;i<kids.length;i++)reclaimed+=nuvioCacheDelete(path.join(target,kids[i]));",
    "try{fs.rmdirSync(target)}catch(e){}",
    "return reclaimed;",
    "}",
    "if(info.isFile()){reclaimed+=info.size;try{fs.unlinkSync(target)}catch(e){}}",
    "return reclaimed;",
    "}",
    'enginefs.router.get("/nuvio-cache/status",function(req,res){',
    "try{",
    "var root=os.tmpdir(),active=nuvioCacheActive(),used=0,activeBytes=0;",
    "nuvioCacheEntries().forEach(function(name){",
    "var bytes=nuvioCacheSize(path.join(root,name));",
    "used+=bytes;",
    "if(active[String(name).toLowerCase()])activeBytes+=bytes;",
    "});",
    "res.writeHead(200,jsonHead);",
    "res.end(JSON.stringify({usedBytes:used,activeBytes:activeBytes,cacheRoot:root}));",
    "}catch(error){res.writeHead(500,jsonHead);res.end(JSON.stringify({error:String(error&&error.message||error)}))}",
    "});",
    'enginefs.router.get("/nuvio-cache/clear",function(req,res){',
    "try{",
    "var root=os.tmpdir(),active=nuvioCacheActive(),reclaimed=0;",
    "nuvioCacheEntries().forEach(function(name){",
    "if(active[String(name).toLowerCase()])return;",
    "reclaimed+=nuvioCacheDelete(path.join(root,name));",
    "});",
    "res.writeHead(200,jsonHead);",
    "res.end(JSON.stringify({cleared:true,reclaimedBytes:reclaimed}));",
    "}catch(error){res.writeHead(500,jsonHead);res.end(JSON.stringify({cleared:false,error:String(error&&error.message||error)}))}",
    "});",
    "})();"
  ].join("");

  return code.replace(target, routes + target);
};
