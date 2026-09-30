---
'@forinda/kickjs': patch
---

`@Cacheable`: classes no longer share cache entries, and simultaneous misses run the method once.

- **Cross-class collision:** the default key was `{method}:{args}`, so `UserService.findAll()` and `PostService.findAll()` read and wrote the same entry, and one could return the other's data. The default key is now `{method}:{ClassName}:{args}`. The method name stays first so existing `@CacheEvict('findAll')` prefixes keep matching. An explicit `options.key` is unchanged.
- **Stampede:** N concurrent misses on one key used to run the method N times. They now share one in-flight call, per process. A failed call isn't cached, so the next call retries.

Existing default-keyed entries in a shared cache (for example Redis) are simply not read after upgrading; they expire on their TTL.
