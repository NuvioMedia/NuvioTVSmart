var crypto = require("crypto");
var fs = require("fs");
var http = require("http");
var https = require("https");
var os = require("os");
var path = require("path");
var URL = require("url").URL;

var IMAGE_PROXY_PATH = "/image-proxy";
var CACHE_DIR = path.join(os.tmpdir(), "nuvio-webos-image-proxy");
var MAX_IMAGE_BYTES = 8 * 1024 * 1024;
var CACHE_CONTROL = "public, max-age=604800, immutable";
var BROWSER_USER_AGENT = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "AppleWebKit/537.36 (KHTML, like Gecko)",
  "Chrome/120.0.0.0 Safari/537.36"
].join(" ");
var ALLOWED_EXTENSIONS = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};
var inflightDownloads = Object.create(null);

function send(res, statusCode, headers, body) {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(
    statusCode,
    Object.assign(
      {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      },
      headers || {}
    )
  );
  if (body) {
    res.end(body);
    return;
  }
  res.end();
}

function ensureCacheDir() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR);
    }
  } catch (error) {
    if (!error || error.code !== "EEXIST") {
      throw error;
    }
  }
}

function getHost(parsed) {
  return String((parsed && parsed.hostname) || "").toLowerCase();
}

function isAllowedImgurHost(hostname) {
  return hostname === "i.imgur.com" || /\.imgur\.com$/.test(hostname);
}

function getExtension(parsed) {
  return path.extname(String((parsed && parsed.pathname) || "")).toLowerCase();
}

function validateTargetUrl(rawUrl) {
  var target = String(rawUrl || "").trim();
  if (!target) {
    return { ok: false, statusCode: 400, message: "Missing url" };
  }

  var parsed = null;
  try {
    parsed = new URL(target);
  } catch (_) {
    return { ok: false, statusCode: 400, message: "Invalid image URL" };
  }
  var protocol = String(parsed.protocol || "").toLowerCase();
  if (protocol !== "https:" && protocol !== "http:") {
    return { ok: false, statusCode: 400, message: "Unsupported image URL protocol" };
  }

  if (!isAllowedImgurHost(getHost(parsed))) {
    return { ok: false, statusCode: 403, message: "Image host is not allowed" };
  }

  var extension = getExtension(parsed);
  if (!ALLOWED_EXTENSIONS[extension]) {
    return { ok: false, statusCode: 415, message: "Unsupported image type" };
  }

  return {
    ok: true,
    target: target,
    parsed: parsed,
    extension: extension,
    fallbackContentType: ALLOWED_EXTENSIONS[extension]
  };
}

function getCacheEntry(target, extension) {
  var hash = crypto.createHash("sha256").update(target).digest("hex");
  var safeExtension = ALLOWED_EXTENSIONS[extension] ? extension : ".img";
  return {
    key: hash,
    filePath: path.join(CACHE_DIR, hash + safeExtension),
    metaPath: path.join(CACHE_DIR, hash + ".json")
  };
}

function readMeta(metaPath, fallbackContentType) {
  try {
    var parsed = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    var contentType = String((parsed && parsed.contentType) || "")
      .trim()
      .toLowerCase();
    if (contentType.indexOf("image/") === 0) {
      return contentType;
    }
  } catch (_) {
    // Missing or malformed metadata is not fatal.
  }
  return fallbackContentType || "application/octet-stream";
}

function hasCachedFile(entry) {
  try {
    var stat = fs.statSync(entry.filePath);
    return stat.isFile() && stat.size > 0;
  } catch (_) {
    return false;
  }
}

function serveCached(entry, fallbackContentType, req, res) {
  var contentType = readMeta(entry.metaPath, fallbackContentType);
  var headers = {
    "Cache-Control": CACHE_CONTROL,
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*"
  };

  if (req.method === "HEAD") {
    send(res, 200, headers);
    return;
  }

  res.writeHead(200, headers);
  fs.createReadStream(entry.filePath)
    .on("error", function () {
      if (!res.headersSent) {
        send(res, 502, { "Content-Type": "text/plain; charset=utf-8" }, "Image cache read failed");
        return;
      }
      res.end();
    })
    .pipe(res);
}

function removeFileQuietly(filename) {
  try {
    fs.unlinkSync(filename);
  } catch (_) {
    // Ignore cleanup failures.
  }
}

function normalizeResponseContentType(value, fallbackContentType) {
  var contentType = String(value || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType.indexOf("image/") === 0) {
    return contentType;
  }
  return fallbackContentType || "";
}

function downloadImage(validated, entry, redirectsLeft) {
  return new Promise(function (resolve, reject) {
    var target = validated.target;
    var parsed = validated.parsed;
    var transport = String(parsed.protocol || "").toLowerCase() === "http:" ? http : https;
    var requestOptions = {
      protocol: parsed.protocol,
      hostname: String(parsed.hostname || "").replace(/^\[|\]$/g, ""),
      port: parsed.port || undefined,
      path: (parsed.pathname || "/") + (parsed.search || ""),
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "User-Agent": BROWSER_USER_AGENT
      }
    };
    if (parsed.username || parsed.password) {
      requestOptions.auth =
        decodeURIComponent(parsed.username || "") + ":" + decodeURIComponent(parsed.password || "");
    }
    var request = transport.get(requestOptions, function (response) {
      var statusCode = Number(response.statusCode || 0);
      var redirectUrl = response.headers && response.headers.location;

      if (statusCode >= 300 && statusCode < 400 && redirectUrl && redirectsLeft > 0) {
        response.resume();
        var nextTarget;
        try {
          nextTarget = new URL(redirectUrl, target).toString();
        } catch (_) {
          reject(new Error("Invalid redirect URL"));
          return;
        }
        var nextValidated = validateTargetUrl(nextTarget);
        if (!nextValidated.ok) {
          reject(new Error(nextValidated.message || "Image redirect is not allowed"));
          return;
        }
        downloadImage(nextValidated, entry, redirectsLeft - 1).then(resolve, reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error("Image request failed with HTTP " + statusCode));
        return;
      }

      var contentLength = Number((response.headers && response.headers["content-length"]) || 0);
      if (contentLength > MAX_IMAGE_BYTES) {
        response.resume();
        reject(new Error("Image exceeds max size"));
        return;
      }

      var contentType = normalizeResponseContentType(
        response.headers && response.headers["content-type"],
        validated.fallbackContentType
      );
      if (!contentType) {
        response.resume();
        reject(new Error("Invalid image content type"));
        return;
      }

      ensureCacheDir();
      var tempPath =
        entry.filePath +
        ".tmp-" +
        process.pid +
        "-" +
        Date.now() +
        "-" +
        Math.random().toString(36).slice(2);
      var stream = fs.createWriteStream(tempPath);
      var receivedBytes = 0;
      var settled = false;

      function fail(error) {
        if (settled) {
          return;
        }
        settled = true;
        response.removeAllListeners("data");
        stream.destroy();
        removeFileQuietly(tempPath);
        reject(error);
      }

      response.on("data", function (chunk) {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_IMAGE_BYTES) {
          request.abort();
          fail(new Error("Image exceeds max size"));
        }
      });

      response.on("error", fail);
      stream.on("error", fail);
      stream.on("finish", function () {
        if (settled) {
          return;
        }
        settled = true;
        fs.rename(tempPath, entry.filePath, function (renameError) {
          if (renameError) {
            removeFileQuietly(tempPath);
            reject(renameError);
            return;
          }
          fs.writeFile(
            entry.metaPath,
            JSON.stringify({
              contentType: contentType,
              source: target,
              updatedAt: Date.now()
            }),
            function () {
              resolve();
            }
          );
        });
      });

      response.pipe(stream);
    });

    request.setTimeout(10000, function () {
      request.abort();
      reject(new Error("Image request timed out"));
    });
    request.on("error", reject);
  });
}

function createImageProxyHandler() {
  return function imageProxyHandler(req, res) {
    var parsedRequest = null;
    try {
      parsedRequest = new URL(req.url || "", "http://127.0.0.1");
    } catch (_) {
      return false;
    }
    if (parsedRequest.pathname !== IMAGE_PROXY_PATH) {
      return false;
    }

    if (req.method === "OPTIONS") {
      send(res, 204);
      return true;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      send(
        res,
        405,
        {
          Allow: "GET, HEAD, OPTIONS",
          "Content-Type": "text/plain; charset=utf-8"
        },
        "Method not allowed"
      );
      return true;
    }

    var validated = validateTargetUrl(parsedRequest.searchParams.get("url"));
    if (!validated.ok) {
      send(
        res,
        validated.statusCode || 400,
        {
          "Content-Type": "text/plain; charset=utf-8"
        },
        validated.message || "Invalid image URL"
      );
      return true;
    }

    var entry = getCacheEntry(validated.target, validated.extension);
    if (hasCachedFile(entry)) {
      serveCached(entry, validated.fallbackContentType, req, res);
      return true;
    }

    try {
      ensureCacheDir();
    } catch (_) {
      send(
        res,
        502,
        { "Content-Type": "text/plain; charset=utf-8" },
        "Image proxy cache unavailable"
      );
      return true;
    }

    if (!inflightDownloads[entry.key]) {
      inflightDownloads[entry.key] = downloadImage(validated, entry, 3)
        .catch(function (error) {
          if (hasCachedFile(entry)) {
            return;
          }
          throw error;
        })
        .then(function () {
          return true;
        });
      inflightDownloads[entry.key].then(
        function () {
          delete inflightDownloads[entry.key];
        },
        function () {
          delete inflightDownloads[entry.key];
        }
      );
    }

    inflightDownloads[entry.key]
      .then(function () {
        if (hasCachedFile(entry)) {
          serveCached(entry, validated.fallbackContentType, req, res);
          return;
        }
        send(res, 502, { "Content-Type": "text/plain; charset=utf-8" }, "Image proxy failed");
      })
      .catch(function () {
        if (hasCachedFile(entry)) {
          serveCached(entry, validated.fallbackContentType, req, res);
          return;
        }
        send(res, 502, { "Content-Type": "text/plain; charset=utf-8" }, "Image proxy failed");
      });

    return true;
  };
}

module.exports = {
  createImageProxyHandler: createImageProxyHandler
};
