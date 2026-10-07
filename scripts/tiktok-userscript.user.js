// ==UserScript==
// @name         EIZ Metrics - TikTok Interceptor
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Captura métricas de TikTok Creator Center en tiempo real y las envía al Dashboard de EIZ
// @author       Antigravity AI
// @match        *://creator.tiktok.com/*
// @match        *://www.tiktok.com/creator-center*
// @match        *://www.tiktok.com/tiktokstudio/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      localhost
// @connect      eiz-metrics.vercel.app
// @run-at       document-start
// ==/UserScript==

/* global unsafeWindow */
(function() {
    'use strict';

    // --- CONFIGURACIÓN ---
    // Nada sensible vive en este archivo: el endpoint, el handle y el token de subida se
    // piden una sola vez (prompt) y se guardan con GM_setValue en Tampermonkey.
    // Podés cambiarlos desde el menú de Tampermonkey → "EIZ Metrics: configurar".
    const DEFAULT_ENDPOINT = 'https://eiz-metrics.vercel.app/api/tiktok/upload';

    function pedirConfig(clave, pregunta, valorPorDefecto) {
        let valor = GM_getValue(clave, '');
        if (!valor) {
            valor = (window.prompt(pregunta, valorPorDefecto || '') || '').trim();
            if (valor) GM_setValue(clave, valor);
        }
        return valor;
    }

    function configurar() {
        GM_setValue('endpoint', '');
        GM_setValue('handle', '');
        GM_setValue('upload_token', '');
        pedirConfig('endpoint', 'EIZ Metrics — URL del endpoint de subida:', DEFAULT_ENDPOINT);
        pedirConfig('handle', 'EIZ Metrics — handle de TikTok (ej: eiz.gg):', '');
        pedirConfig('upload_token', 'EIZ Metrics — token de subida (lo generás en la pantalla "Cuentas"):', '');
    }
    GM_registerMenuCommand('EIZ Metrics: configurar', configurar);

    // --- MODO DESCUBRIMIENTO ---
    // Los endpoints de TikTok Studio para retención, audiencia y tráfico cambian y no están documentados.
    // Con este modo activo, el script loguea en la consola la URL y la forma (claves) de cada respuesta
    // JSON de analytics, para poder agregar los matchers y documentarlos en docs/tiktok-endpoints.md.
    GM_registerMenuCommand('EIZ Metrics: alternar modo descubrimiento', function () {
        const on = !GM_getValue('discovery', false);
        GM_setValue('discovery', on);
        window.alert('Modo descubrimiento ' + (on ? 'ACTIVADO' : 'desactivado') + '. Recargá la página.');
    });

    const DISCOVERY_RE = /analytics|insight|retention|audience|follower|traffic|creator/i;

    function describirForma(valor, profundidad) {
        if (profundidad > 3 || valor === null || typeof valor !== 'object') return typeof valor;
        if (Array.isArray(valor)) return valor.length ? [describirForma(valor[0], profundidad + 1), 'x' + valor.length] : [];
        const salida = {};
        Object.keys(valor).slice(0, 25).forEach(function (k) { salida[k] = describirForma(valor[k], profundidad + 1); });
        return salida;
    }

    function descubrir(url, texto) {
        if (!GM_getValue('discovery', false) || typeof url !== 'string' || !DISCOVERY_RE.test(url)) return;
        try {
            console.log('🔎 [EIZ Metrics][descubrimiento]', url.split('?')[0], describirForma(JSON.parse(texto), 0));
        } catch (e) { /* no era JSON */ }
    }

    function getConfig() {
        return {
            endpoint: pedirConfig('endpoint', 'EIZ Metrics — URL del endpoint de subida:', DEFAULT_ENDPOINT),
            handle: pedirConfig('handle', 'EIZ Metrics — handle de TikTok (ej: eiz.gg):', ''),
            token: pedirConfig('upload_token', 'EIZ Metrics — token de subida (lo generás en la pantalla "Cuentas"):', '')
        };
    }

    console.log('🦁 [EIZ Metrics] Interceptor de red de TikTok activado. Esperando llamadas de datos...');

    // Helper para enviar los datos procesados al Dashboard
    function enviarAlDashboard(payload) {
        const cfg = getConfig();
        if (!cfg.endpoint || !cfg.token) {
            console.warn('🦁 [EIZ Metrics] Falta configurar endpoint/token. Usá el menú de Tampermonkey.');
            return;
        }
        console.log('🦁 [EIZ Metrics] Enviando payload al Dashboard:', payload);

        GM_xmlhttpRequest({
            method: 'POST',
            url: cfg.endpoint,
            headers: {
                'Content-Type': 'application/json',
                'x-tiktok-upload-token': cfg.token
            },
            data: JSON.stringify(Object.assign({ handle: cfg.handle || undefined }, payload)),
            onload: function(res) {
                if (res.status === 200) {
                    console.log('🦁 [EIZ Metrics] ¡Métricas subidas con éxito!', res.responseText);
                } else {
                    console.error('🦁 [EIZ Metrics] Error de servidor al subir métricas:', res.status, res.responseText);
                }
            },
            onerror: function(err) {
                console.error('🦁 [EIZ Metrics] Error de red al enviar al Dashboard:', err);
            }
        });
    }

    // --- ENDPOINTS DE TIKTOK STUDIO (descubiertos con el modo descubrimiento, oct 2026) ---
    // Ver docs/tiktok-endpoints.md. Si TikTok los cambia, reactivar el modo descubrimiento.
    const RE_LISTA_VIDEOS = /\/tiktok\/creator\/manage\/item_list\/v1|\/api\/creator\/item\/list|\/analytics\/post|\/creator-center\/api\/video\/list|\/share\/analytics\/item_list/;
    const RE_SEGUIDORES = /\/relation\/multiGetFollowRelationCount|\/api\/creator\/user\/info|\/creator-center\/api\/user\/stats/;

    function primerNumero(valor) {
        if (typeof valor === 'number') return valor;
        // TikTok suele devolver los contadores como string ("3170")
        if (typeof valor === 'string' && /^[0-9]+$/.test(valor)) return Number(valor);
        if (valor && typeof valor === 'object') {
            const claves = Object.keys(valor);
            for (let i = 0; i < claves.length; i++) {
                const n = primerNumero(valor[claves[i]]);
                if (typeof n === 'number') return n;
            }
        }
        return undefined;
    }

    // Primer valor numérico (o string numérico) entre varias claves candidatas
    function pick() {
        for (let i = 0; i < arguments.length; i++) {
            const v = arguments[i];
            if (v !== undefined && v !== null && v !== '' && !isNaN(Number(v))) return Number(v);
        }
        return 0;
    }

    // La lista puede venir bajo distintas claves; si no está en las conocidas, se busca el primer array de objetos con id
    function buscarLista(data) {
        const raiz = (data && data.data) || data || {};
        const conocidas = ['item_list', 'items', 'videos', 'itemList', 'list'];
        for (let i = 0; i < conocidas.length; i++) {
            if (Array.isArray(raiz[conocidas[i]])) return raiz[conocidas[i]];
            if (data && Array.isArray(data[conocidas[i]])) return data[conocidas[i]];
        }
        const claves = Object.keys(raiz);
        for (let j = 0; j < claves.length; j++) {
            const v = raiz[claves[j]];
            if (Array.isArray(v) && v.length && typeof v[0] === 'object' && (v[0].item_id || v[0].id || v[0].itemId)) return v;
        }
        return [];
    }

    let yaLogueoItem = false;

    // Helper para procesar listas de videos interceptados
    function procesarVideos(itemList) {
        if (!itemList || !Array.isArray(itemList) || itemList.length === 0) return;

        // Una vez por página: el primer item crudo, para poder ajustar el mapeo si TikTok cambia los nombres
        if (!yaLogueoItem) {
            yaLogueoItem = true;
            try { console.log('🦁 [EIZ Metrics] Primer item crudo:', JSON.stringify(itemList[0]).slice(0, 2500)); } catch (e) { /* nada */ }
        }

        const videos = itemList.map(function (item) {
            const externalId = item.item_id || item.id || item.itemId || item.aweme_id;
            if (!externalId) return null;

            // Las stats pueden venir anidadas (statistics / stats / item_stats) o planas en el item
            const stats = item.statistics || item.stats || item.item_stats || item.metrics || {};
            const views = pick(stats.play_count, stats.playCount, stats.view_count, stats.views, item.play_count, item.playCount, item.view_count, item.views);
            const likes = pick(stats.digg_count, stats.diggCount, stats.like_count, stats.likes, item.digg_count, item.like_count, item.likeCount, item.likes);
            const comments = pick(stats.comment_count, stats.commentCount, stats.comments, item.comment_count, item.commentCount, item.comments);
            const shares = pick(stats.share_count, stats.shareCount, stats.shares, item.share_count, item.shareCount, item.shares);
            const saves = pick(stats.collect_count, stats.collectCount, stats.favorite_count, stats.saves, item.collect_count, item.collectCount, item.favorite_count);

            // Intentar extraer retención si está disponible en la respuesta
            let retention_pct = null;
            let avg_watch_time_seconds = null;
            if (item.analytics) {
                retention_pct = typeof item.analytics.retention_rate === 'number' ? item.analytics.retention_rate : null;
                avg_watch_time_seconds = typeof item.analytics.average_watch_time === 'number' ? item.analytics.average_watch_time : null;
            }

            const creado = pick(item.create_time, item.createTime, item.create_timestamp);
            const duracion = pick(item.duration, item.video_duration, item.video && item.video.duration);
            const handle = (GM_getValue('handle', '') || '').replace(/^@/, '');

            return {
                id: String(externalId),
                title: item.desc || item.title || item.description || '',
                url: 'https://www.tiktok.com/@' + handle + '/video/' + externalId,
                // item_list/v1 manda la duración en milisegundos (50034 = 00:50)
                duration: duracion ? Math.round(duracion / 1000) : null,
                // create_time viene en segundos
                published_at: creado ? (creado < 1e12 ? creado * 1000 : creado) : Date.now(),
                views: views,
                likes: likes,
                comments: comments,
                shares: shares,
                saves: saves,
                retention_pct: retention_pct,
                avg_watch_time_seconds: avg_watch_time_seconds
            };
        }).filter(function (v) { return v !== null; });

        if (videos.length > 0) {
            console.log('🦁 [EIZ Metrics] Se encontraron ' + videos.length + ' videos listos para enviar.');
            enviarAlDashboard({ platform: 'tiktok', videos: videos });
        }
    }

    function procesarSeguidores(data) {
        // multiGetFollowRelationCount devuelve { FollowerCount: { <uid>: n }, ... }; los endpoints viejos, un número plano
        const stats = (data && data.data && (data.data.user_stats || data.data)) || (data && data.user_stats) || data || {};
        const candidato = stats.FollowerCount !== undefined ? stats.FollowerCount
            : stats.follower_count !== undefined ? stats.follower_count
            : stats.followerCount !== undefined ? stats.followerCount
            : stats.followers;
        const followers = primerNumero(candidato);
        if (typeof followers === 'number' && followers >= 0) {
            console.log('🦁 [EIZ Metrics] Seguidores detectados: ' + followers);
            enviarAlDashboard({ platform: 'tiktok', followers: Math.round(followers) });
        } else {
            try { console.warn('🦁 [EIZ Metrics] No pude leer los seguidores. FollowerCount crudo:', JSON.stringify(candidato).slice(0, 500)); } catch (e) { /* nada */ }
        }
    }

    // Procesa una respuesta ya leída (la comparten fetch y XHR)
    function procesarRespuesta(url, texto, origen) {
        if (typeof url !== 'string') return;
        descubrir(url, texto);
        const esLista = RE_LISTA_VIDEOS.test(url);
        const esSeguidores = RE_SEGUIDORES.test(url);
        if (!esLista && !esSeguidores) return;
        try {
            const data = JSON.parse(texto);
            if (esLista) {
                console.log('🦁 [EIZ Metrics] Petición ' + origen + ' de videos capturada:', url.split('?')[0]);
                procesarVideos(buscarLista(data));
            }
            if (esSeguidores) {
                console.log('🦁 [EIZ Metrics] Petición ' + origen + ' de usuario capturada:', url.split('?')[0]);
                procesarSeguidores(data);
            }
        } catch (e) {
            console.warn('🦁 [EIZ Metrics] Error al procesar respuesta ' + origen + ':', e);
        }
    }

    // Con @grant el script corre en un sandbox: hay que parchear el fetch/XHR REAL de la página (unsafeWindow)
    const pagina = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // Interceptar llamadas a través de fetch
    const originalFetch = pagina.fetch.bind(pagina);
    pagina.fetch = async function (...args) {
        const response = await originalFetch(...args);
        // fetch puede recibir un string, un URL o un Request
        const primero = args[0];
        const url = typeof primero === 'string' ? primero : (primero && (primero.url || String(primero))) || '';
        response.clone().text().then(function (t) { procesarRespuesta(url, t, 'FETCH'); }).catch(function () { /* respuesta no legible */ });
        return response;
    };

    // Interceptar llamadas a través de XMLHttpRequest
    const originalOpen = pagina.XMLHttpRequest.prototype.open;
    const originalSend = pagina.XMLHttpRequest.prototype.send;

    pagina.XMLHttpRequest.prototype.open = function (method, url) {
        this._url = String(url);
        return originalOpen.apply(this, arguments);
    };

    pagina.XMLHttpRequest.prototype.send = function () {
        this.addEventListener('load', function () {
            try { procesarRespuesta(this._url, this.responseText, 'XHR'); } catch (e) { /* responseType no texto */ }
        });
        return originalSend.apply(this, arguments);
    };

})();
