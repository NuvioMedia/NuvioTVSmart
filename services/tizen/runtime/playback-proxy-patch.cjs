/* Transport repairs for the vendored EngineFS proxy. ES5 for TV service runtimes. */
module.exports = function patchPlaybackProxy(source) {
  if (source.indexOf("/* NUVIO_FIX_PROXY */") !== -1) return source;

  function replaceOnce(target, replacement) {
    var position = source.indexOf(target);
    if (position === -1 || source.indexOf(target, position + target.length) !== -1) {
      throw new Error("Unknown EngineFS proxy layout: " + target.slice(0, 60));
    }
    source = source.replace(target, replacement);
  }

  // node-fetch rejects an HTTPS agent for an HTTP destination, including redirects.
  replaceOnce(
    'agent:httpsAgent,redirect:"manual"',
    'agent:dest.protocol==="https:"?httpsAgent:void 0,redirect:"manual"'
  );

  // Resolve every playlist URI against the final manifest, including ../ and query-only URIs.
  replaceOnce(
    "function parseUrl(line){if(line.startsWith",
    "function parseUrl(line){line=url.resolve(url.format(dest),line);if(line.startsWith"
  );
  // url.parse().host already includes the port.
  replaceOnce(
    'lineUrl.protocol+"//"+lineUrl.host+(lineUrl.port?":"+lineUrl.port:"")',
    'lineUrl.protocol+"//"+lineUrl.host'
  );

  // Keep the router's destination object current: it determines playlist detection
  // and child URLs after the fetch finishes. Retain explicitly declared source
  // headers on each hop, as Android's playback HTTP client does.
  replaceOnce(
    'dest=url.parse(url.resolve(dest.href.slice(0,-(dest.path||"").length-(dest.hash||"").length),newLocation)),headers=new Headers(makeHeaders(headers,proxyReqHeaders,{host:dest.host})),opts[cfgOpts.DestinationHeader].forEach((function(headerString){headers.set.apply(headers,parseHeaderString(headerString))})),redirectCount+=1,!0',
    [
      "(function(){",
      "var nextDest=url.parse(url.resolve(url.format(dest),newLocation));",
      "Object.keys(dest).forEach(function(key){delete dest[key]});",
      "Object.keys(nextDest).forEach(function(key){dest[key]=nextDest[key]});",
      'opts[cfgOpts.Destination]=dest.protocol+"//"+dest.host;',
      "headers=new Headers(makeHeaders(headers,proxyReqHeaders,{host:dest.host}));",
      "opts[cfgOpts.DestinationHeader].forEach(function(headerString){headers.set.apply(headers,parseHeaderString(headerString))});",
      'if(result.body&&typeof result.body.destroy==="function")result.body.destroy();',
      "redirectCount+=1;return true})()"
    ].join("")
  );

  // This node-fetch version does not propagate body destruction to its socket.
  replaceOnce(
    "response_options={url:request.url,status:res.statusCode",
    "response_options={nuvioClose:function(){res.destroy()},url:request.url,status:res.statusCode"
  );

  // Attach to the final body too: gzip/deflate may wrap the PassThrough.
  replaceOnce(
    "Body.call(this,body,opts);var status=opts.status||200",
    'Body.call(this,body,opts);if(body&&opts.nuvioClose)body.on("close",opts.nuvioClose);var status=opts.status||200'
  );

  replaceOnce(
    "var responseHeaders=makeHeaders(result.headers,proxyResHeaders);",
    [
      'res.on("close",function(){if(result.body&&typeof result.body.destroy==="function")result.body.destroy()});',
      'if(result.body){result.body.on("error",function(error){res.destroy(error)})}',
      "var responseHeaders=makeHeaders(result.headers,proxyResHeaders);"
    ].join("")
  );
  return source + "\n/* NUVIO_FIX_PROXY */\n";
};
