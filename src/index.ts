import { Elysia, t } from 'elysia';
import { LRUCache } from 'lru-cache';
import { rateLimit } from 'elysia-rate-limit';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileLogger, logger } from '@bogeychan/elysia-logger';

const DEFAULT_PORT = 3000;
const DEFAULT_TTL = 60 * 60 * 1000;
const DEFAULT_QPS_LIMIT = 20;

const cache = new LRUCache({
  max: 100,
  ttl: Number(process.env.CACHE_TTL) || DEFAULT_TTL,
});

const LOG_DIR_PATH = resolvePath('./logs');
const URL_TESTER = /^(((https?:\/\/)?(?:[\-;:&=\+\$,\w]+@)?[A-Za-z0-9\.\-]+|(?:www\.|[\-;:&=\+\$,\w]+@)[A-Za-z0-9\.\-]+)((?:\/[\+~%\/\.\w\-_]*)?\??(?:[\-\+=&;%@\.\w_]*)#?(?:[\.\!\/\\\w]*))?)$/;
const SERVER_PORT = Number(process.env.PORT) || DEFAULT_PORT;

if (!existsSync(LOG_DIR_PATH)) {
  mkdirSync(LOG_DIR_PATH, { recursive: true });
}

new Elysia()
  .use(
    logger()
  )
  .use(
    fileLogger({
      file: './logs/error.log',
      level: 'error',
    })
  )
  .use(
    fileLogger({
      file: './logs/all.log',
      level: 'info',
    })
  )
  .use(
    // limit qps to 20
    rateLimit({
      duration: 1000,
      max: Number(process.env.QPS_LIMIT) || DEFAULT_QPS_LIMIT,
    })
  )
  .get(
    '/',
    async ({ query: { q }, error, set }) => {
      const setResponseHeader = () => {
        set.headers['Cache-Control'] = 'public, max-age=86400';
        set.headers['Content-Type'] = 'text/html; charset=UTF-8';
      };

      const decoded = decodeURIComponent(q);
      const targetURL = decoded.startsWith('cache:') ? decoded.slice(6) : decoded;

      if (!URL_TESTER.test(targetURL)) {
        return error('Bad Request', 'Invalid query url');
      }

      if (cache.has(targetURL)) {
        setResponseHeader();
        return cache.get(targetURL);
      }

      try {
        const res = await fetch(`https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(targetURL)}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0; +https://openai.com/gptbot)',
          },
        });

        if (res.ok) {
          setResponseHeader();
          const webCache = await res.text();
          cache.set(targetURL, webCache);
          return webCache;
        } else {
          return error('Internal Server Error', 'Invalid response from google webcache');
        }
      } catch (err) {
        return error('Internal Server Error', 'Failed to request google webcache');
      }
    },
    {
      query: t.Object({
        q: t.String(),
      }),
    }
  )
  .listen(SERVER_PORT);

console.log(`Server is listening on port ${SERVER_PORT}.`);
