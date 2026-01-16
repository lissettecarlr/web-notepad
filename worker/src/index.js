// Cloudflare Workers API 后端
// 处理笔记的保存和加载

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS 处理
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // 处理 OPTIONS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 加载笔记
      if (path.startsWith('/load/') && request.method === 'GET') {
        const notebook = path.split('/load/')[1];
        
        // 验证笔记本名称
        if (!/^[a-zA-Z0-9_-]+$/.test(notebook)) {
          return new Response(
            JSON.stringify({ status: 'error', message: '非法的笔记本名称' }),
            { 
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
          );
        }

        const content = await env.NOTES_KV.get(notebook);
        return new Response(
          JSON.stringify({ 
            status: 'success', 
            content: content || '' 
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      // 保存笔记
      if (path === '/save' && request.method === 'POST') {
        const data = await request.json();
        const { content, notebook } = data;

        if (!notebook || !/^[a-zA-Z0-9_-]+$/.test(notebook)) {
          return new Response(
            JSON.stringify({ status: 'error', message: '非法的笔记本名称' }),
            { 
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
          );
        }

        // KV 单个值最大 25MB，足够存储笔记
        await env.NOTES_KV.put(notebook, content || '');
        
        return new Response(
          JSON.stringify({ status: 'success' }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      // 404
      return new Response(
        JSON.stringify({ status: 'error', message: 'Not Found' }),
        { 
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );

    } catch (error) {
      return new Response(
        JSON.stringify({ status: 'error', message: error.message }),
        { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
  },
};
