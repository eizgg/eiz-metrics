// ==UserScript==
// @name         EIZ Metrics - TikTok Interceptor
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Captura métricas de TikTok Creator Center en tiempo real y las envía al Dashboard de EIZ
// @author       Antigravity AI
// @match        *://creator.tiktok.com/*
// @match        *://www.tiktok.com/creator-center*
// @match        *://www.tiktok.com/tiktokstudio/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      eiz-metrics.vercel.app
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // --- CONFIGURACIÓN DE TU DASHBOARD ---
    // En desarrollo local puedes usar: 'http://localhost:5173/api/tiktok/upload'
    // En producción usa la URL de tu Vercel: 'https://eiz-metrics.vercel.app/api/tiktok/upload'
    const DASHBOARD_ENDPOINT = 'http://localhost:3000/api/tiktok/upload'; 
    const UPLOAD_TOKEN = 'eiz_manual_metrics_upload_secret_token_2026'; // Debe coincidir con TIKTOK_MANUAL_UPLOAD_TOKEN en tu .env

    console.log('🦁 [EIZ Metrics] Interceptor de red de TikTok activado. Esperando llamadas de datos...');

    // Helper para enviar los datos procesados al Dashboard
    function enviarAlDashboard(payload) {
        console.log('🦁 [EIZ Metrics] Enviando payload al Dashboard:', payload);

        GM_xmlhttpRequest({
            method: 'POST',
            url: DASHBOARD_ENDPOINT,
            headers: {
                'Content-Type': 'application/json',
                'x-tiktok-upload-token': UPLOAD_TOKEN
            },
            data: JSON.stringify(payload),
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

    // Helper para procesar listas de videos interceptados
    function procesarVideos(itemList) {
        if (!itemList || !Array.isArray(itemList) || itemList.length === 0) return;

        const videos = itemList.map(item => {
            const externalId = item.item_id || item.id || item.itemId;
            if (!externalId) return null;

            // Extraer estadísticas básicas
            const stats = item.statistics || item.stats || {};
            const views = parseInt(stats.play_count || stats.playCount || item.play_count || item.playCount || 0);
            const likes = parseInt(stats.digg_count || stats.diggCount || item.like_count || item.likeCount || 0);
            const comments = parseInt(stats.comment_count || stats.commentCount || item.comment_count || item.commentCount || 0);
            const shares = parseInt(stats.share_count || stats.shareCount || item.share_count || item.shareCount || 0);
            const saves = parseInt(stats.collect_count || stats.collectCount || item.collect_count || item.collectCount || 0);

            // Intentar extraer retención si está disponible en la respuesta (varía según la pestaña en la que esté el usuario)
            let retention_pct = null;
            let avg_watch_time_seconds = null;
            if (item.analytics) {
                retention_pct = typeof item.analytics.retention_rate === 'number' ? item.analytics.retention_rate : null;
                avg_watch_time_seconds = typeof item.analytics.average_watch_time === 'number' ? item.analytics.average_watch_time : null;
            }

            return {
                id: String(externalId),
                title: item.desc || item.title || '',
                url: `https://www.tiktok.com/@eiz.gg/video/${externalId}`,
                duration: item.duration || null,
                published_at: item.create_time ? item.create_time * 1000 : item.createTime || Date.now(),
                views,
                likes,
                comments,
                shares,
                saves,
                retention_pct,
                avg_watch_time_seconds
            };
        }).filter(v => v !== null);

        if (videos.length > 0) {
            console.log(`🦁 [EIZ Metrics] Se encontraron ${videos.length} videos listos para enviar.`);
            enviarAlDashboard({
                platform: 'tiktok',
                videos
            });
        }
    }

    // Interceptar llamadas a través de window.fetch
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch(...args);
        const url = args[0];

        if (typeof url === 'string') {
            // Endpoints comunes de TikTok Creator Center
            if (url.includes('/api/creator/item/list') || 
                url.includes('/analytics/post') || 
                url.includes('/creator-center/api/video/list') ||
                url.includes('/share/analytics/item_list')) {
                
                try {
                    const clone = response.clone();
                    const data = await clone.json();
                    console.log('🦁 [EIZ Metrics] Petición FETCH de videos capturada:', url);
                    
                    const itemList = data?.data?.item_list || data?.item_list || data?.data?.videos || data?.videos || [];
                    procesarVideos(itemList);
                } catch (e) {
                    console.warn('🦁 [EIZ Metrics] Error al procesar respuesta FETCH de videos:', e);
                }
            }

            // Capturar seguidores de info de perfil
            if (url.includes('/api/creator/user/info') || url.includes('/creator-center/api/user/stats')) {
                try {
                    const clone = response.clone();
                    const data = await clone.json();
                    console.log('🦁 [EIZ Metrics] Petición FETCH de usuario capturada:', url);
                    
                    const stats = data?.data?.user_stats || data?.user_stats || data?.data || {};
                    const followers = stats.follower_count || stats.followerCount || stats.followers;
                    if (typeof followers === 'number') {
                        console.log(`🦁 [EIZ Metrics] Seguidores detectados: ${followers}`);
                        enviarAlDashboard({
                            platform: 'tiktok',
                            followers
                        });
                    }
                } catch (e) {
                    console.warn('🦁 [EIZ Metrics] Error al procesar respuesta FETCH de usuario:', e);
                }
            }
        }

        return response;
    };

    // Interceptar llamadas a través de XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            const url = this._url;
            if (typeof url === 'string') {
                if (url.includes('/api/creator/item/list') || 
                    url.includes('/analytics/post') || 
                    url.includes('/creator-center/api/video/list') ||
                    url.includes('/share/analytics/item_list')) {
                    
                    try {
                        const data = JSON.parse(this.responseText);
                        console.log('🦁 [EIZ Metrics] Petición XHR de videos capturada:', url);
                        const itemList = data?.data?.item_list || data?.item_list || data?.data?.videos || data?.videos || [];
                        procesarVideos(itemList);
                    } catch (e) {
                        // Respuesta no es JSON o formato inválido
                    }
                }

                if (url.includes('/api/creator/user/info') || url.includes('/creator-center/api/user/stats')) {
                    try {
                        const data = JSON.parse(this.responseText);
                        console.log('🦁 [EIZ Metrics] Petición XHR de usuario capturada:', url);
                        const stats = data?.data?.user_stats || data?.user_stats || data?.data || {};
                        const followers = stats.follower_count || stats.followerCount || stats.followers;
                        if (typeof followers === 'number') {
                            console.log(`🦁 [EIZ Metrics] Seguidores detectados: ${followers}`);
                            enviarAlDashboard({
                                platform: 'tiktok',
                                followers
                            });
                        }
                    } catch (e) {
                        // Respuesta no es JSON o formato inválido
                    }
                }
            }
        });
        return originalSend.apply(this, arguments);
    };

})();
