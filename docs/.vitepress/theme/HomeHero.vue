<script setup lang="ts">
import { VPButton } from 'vitepress/theme'
</script>

<template>
    <section class="kickjs-hero">
        <div class="hero-bg" />
        <div class="hero-content">
            <div class="hero-badge">
                <span class="badge-dot" />
                Open Source &middot; MIT Licensed
            </div>
            <h1 class="hero-name">
                Kick<span class="hero-accent">JS</span>
            </h1>
            <p class="hero-text">The Adaptive Node.js Framework</p>
            <p class="hero-tagline">
                Decorator-driven APIs on Express 5. REST, GraphQL, WebSocket, queues
                &mdash; pick what you need. TypeScript-first, pluggable, production-ready.
            </p>
            <div class="hero-actions">
                <VPButton tag="a" size="medium" theme="brand" text="Get Started"
                    href="/guide/getting-started" />
                <VPButton tag="a" size="medium" theme="alt" text="Why KickJS?" href="/guide/what-is-kickjs" />
                <VPButton tag="a" size="medium" theme="alt" text="GitHub" href="https://github.com/forinda/kick-js" />
            </div>
            <div class="hero-install">
                <code>npx @forinda/kickjs-cli new my-api</code>
            </div>
        </div>
        <div class="hero-visual">
            <div class="hero-code">
                <div class="code-header">
                    <span class="code-dot red" />
                    <span class="code-dot yellow" />
                    <span class="code-dot green" />
                    <span class="code-title">src/index.ts</span>
                </div>
                <pre class="code-body"><span class="hl-keyword">import</span> { bootstrap, helmet, cors } <span class="hl-keyword">from</span> <span class="hl-string">'@forinda/kickjs'</span>
<span class="hl-keyword">import</span> { modules } <span class="hl-keyword">from</span> <span class="hl-string">'./modules'</span>

bootstrap({
  modules,
  middleware: [helmet(), cors(), express.json()],
})</pre>
            </div>
        </div>
    </section>
</template>

<style scoped>
.kickjs-hero {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 48px;
    max-width: 1280px;
    margin: 0 auto;
    padding: 80px 24px 64px;
    min-height: 70vh;
    overflow: hidden;
}

.hero-bg {
    position: absolute;
    top: -200px;
    right: -200px;
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, rgba(59, 130, 246, 0.12) 0%, transparent 70%);
    border-radius: 50%;
    pointer-events: none;
    z-index: 0;
}

.dark .hero-bg {
    background: radial-gradient(circle, rgba(59, 130, 246, 0.08) 0%, transparent 70%);
}

.hero-content {
    flex: 1;
    max-width: 560px;
    z-index: 1;
}

.hero-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 14px;
    border-radius: 20px;
    background: var(--vp-c-brand-soft);
    color: var(--vp-c-brand-1);
    font-size: 0.8rem;
    font-weight: 500;
    margin-bottom: 24px;
}

.badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #10b981;
    display: inline-block;
}

.hero-name {
    font-size: 4rem;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.02em;
    margin: 0 0 16px;
}

.hero-accent {
    background: linear-gradient(120deg, #3b82f6 30%, #8b5cf6);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

.hero-text {
    font-size: 1.4rem;
    font-weight: 600;
    color: var(--vp-c-text-1);
    margin: 0 0 12px;
}

.hero-tagline {
    font-size: 1.05rem;
    line-height: 1.7;
    color: var(--vp-c-text-2);
    margin: 0 0 32px;
}

.hero-actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
}

.hero-install {
    margin-top: 28px;
}

.hero-install code {
    display: inline-block;
    padding: 10px 20px;
    border-radius: 8px;
    background: var(--vp-c-bg-soft);
    border: 1px solid var(--vp-c-divider);
    font-family: var(--vp-font-family-mono);
    font-size: 0.9rem;
    color: var(--vp-c-text-1);
    letter-spacing: -0.01em;
}

/* ── Code Preview ─── */

.hero-visual {
    flex: 1;
    max-width: 480px;
    z-index: 1;
}

.hero-code {
    border-radius: 12px;
    overflow: hidden;
    background: var(--vp-c-bg-soft);
    border: 1px solid var(--vp-c-divider);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.06);
}

.dark .hero-code {
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.code-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--vp-c-divider);
}

.code-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
}

.code-dot.red {
    background: #ef4444;
}

.code-dot.yellow {
    background: #f59e0b;
}

.code-dot.green {
    background: #10b981;
}

.code-title {
    margin-left: 8px;
    font-size: 0.75rem;
    color: var(--vp-c-text-3);
    font-family: var(--vp-font-family-mono);
}

.code-body {
    margin: 0;
    padding: 20px;
    font-family: var(--vp-font-family-mono);
    font-size: 0.85rem;
    line-height: 1.7;
    overflow-x: auto;
    color: var(--vp-c-text-1);
}

.hl-keyword {
    color: #8b5cf6;
}

.hl-string {
    color: #10b981;
}

.dark .hl-keyword {
    color: #a78bfa;
}

.dark .hl-string {
    color: #34d399;
}

/* ── Responsive ─── */

@media (max-width: 960px) {
    .kickjs-hero {
        flex-direction: column;
        text-align: center;
        padding: 48px 24px 32px;
        min-height: auto;
    }

    .hero-content {
        max-width: 100%;
    }

    .hero-name {
        font-size: 3rem;
    }

    .hero-actions {
        justify-content: center;
    }

    .hero-visual {
        max-width: 100%;
    }
}

@media (max-width: 640px) {
    .hero-name {
        font-size: 2.4rem;
    }

    .hero-text {
        font-size: 1.2rem;
    }
}
</style>
