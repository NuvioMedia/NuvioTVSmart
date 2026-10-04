/* Transport repair for the vendored EngineFS proxy. ES5 for TV service runtimes. */
module.exports = function patchPlaybackProxy(source) {
  if (source.indexOf('/* NUVIO_FIX_PROXY */') !== -1) return source;
  function replaceOnce(target, replacement) {
    if (source.indexOf(target) === -1) throw new Error('Unknown EngineFS proxy layout: ' + target.slice(0, 60));
    source = source.replace(target, replacement);
  }
  replaceOnce('agent:httpsAgent,redirect:"manual"', 'agent:dest.protocol==="https:"?httpsAgent:void 0,redirect:"manual"');
  replaceOnce('function parseUrl(line){if(line.startsWith', 'function parseUrl(line){line=url.resolve(url.format(dest),line);if(line.startsWith');
  replaceOnce('dest=url.parse(url.resolve(dest.href.slice(0,-(dest.path||"").length-(dest.hash||"").length),newLocation)),headers=new Headers(makeHeaders(headers,proxyReqHeaders,{host:dest.host})),opts[cfgOpts.DestinationHeader].forEach((function(headerString){headers.set.apply(headers,parseHeaderString(headerString))})),redirectCount+=1,!0',
    '(function(){var nextDest=url.parse(url.resolve(url.format(dest),newLocation)),crossOrigin=nextDest.protocol!==dest.protocol||nextDest.host!==dest.host;Object.keys(dest).forEach(function(key){delete dest[key]});Object.keys(nextDest).forEach(function(key){dest[key]=nextDest[key]});opts[cfgOpts.Destination]=dest.protocol+"//"+dest.host;if(crossOrigin){opts[cfgOpts.DestinationHeader]=opts[cfgOpts.DestinationHeader].filter(function(header){return !/^(authorization|cookie|proxy-authorization):/i.test(header)});headers.delete("authorization");headers.delete("cookie");headers.delete("proxy-authorization")}headers=new Headers(makeHeaders(headers,proxyReqHeaders,{host:dest.host}));opts[cfgOpts.DestinationHeader].forEach(function(headerString){headers.set.apply(headers,parseHeaderString(headerString))});if(result.body&&typeof result.body.destroy==="function")result.body.destroy();redirectCount+=1;return true})()');
  replaceOnce('var responseHeaders=makeHeaders(result.headers,proxyResHeaders);', 'res.on("close",function(){if(result.body&&typeof result.body.destroy==="function")result.body.destroy()});result.body.on("error",function(error){res.destroy(error)});var responseHeaders=makeHeaders(result.headers,proxyResHeaders);');
  return source + '\n/* NUVIO_FIX_PROXY */\n';
};
