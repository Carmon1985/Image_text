// Load environment variables
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Proxy for MyQA image generation
app.post('/myqa/image/generate', async (req, res) => {
  console.log('Received request at /myqa/image/generate');
  const { apiKey, prompt } = req.body;
  const key = apiKey || process.env.IMAGE_ROUTER_API_KEY;
  const model = 'google/gemini-2.0-flash-exp:free';
  const endpoint = 'https://ir-api.myqa.cc/v1/openai/images/generations';
  try {
    console.log('Sending request to ir-api.myqa.cc with:', { model, prompt, key: key ? '[HIDDEN]' : '[MISSING]' });
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        prompt,
        model
      }),
    });

    let text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (jsonErr) {
      console.error('Non-JSON response from ir-api.myqa.cc:', text);
      throw new Error('Non-JSON response from ir-api.myqa.cc');
    }

    console.log('ir-api.myqa.cc image API status:', response.status);
    console.log('ir-api.myqa.cc image API response:', data);

    // --- Transform Gemini b64_json response for UI ---
    if (data && Array.isArray(data.data) && data.data[0] && data.data[0].b64_json) {
      res.status(200).json({
        type: 'base64',
        data: data.data[0].b64_json,
        mimeType: 'image/png'
      });
      return;
    }
    // --- Otherwise, forward the original response ---
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Proxy error in /myqa/image/generate:', err);
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
});

// Proxy for MyQA chat completions
app.post('/myqa/chat/completions', async (req, res) => {
  const { apiKey, targetModel, targetMessages } = req.body;
  const key = apiKey || process.env.IMAGE_ROUTER_API_KEY;
  console.log('Chat completion request:', { model: targetModel, messages: targetMessages, key: key ? '[HIDDEN]' : '[MISSING]' });
  try {
    const response = await fetch('https://ir-api.myqa.cc/v1/openai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({ model: targetModel, messages: targetMessages }),
    });
    let text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (jsonErr) {
      console.error('Non-JSON response from chat completions:', text);
      throw new Error('Non-JSON response from chat completions');
    }
    console.log('Chat completion response status:', response.status);
    console.log('Chat completion response data:', data);
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Proxy error in /myqa/chat/completions:', err);
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
});

// Proxy for OpenRouter chat completions
app.post('/openrouter/chat/completions', async (req, res) => {
  const { apiKey, targetModel, targetMessages } = req.body;
  const key = apiKey || process.env.OPEN_ROUTER_API_KEY;
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({ model: targetModel, messages: targetMessages }),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
});

// --- Web Search Proxy Route ---
app.post('/search', async (req, res) => {
  const { query } = req.body;
  try {
    let json;
    if (process.env.SERPER_API_KEY) {
      const r = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': process.env.SERPER_API_KEY
        },
        body: JSON.stringify({ q: query, num: 5 })
      });
      json = await r.json();
    } else {
      // free fallback (DuckDuckGo Instant Answer)
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
      const r = await fetch(url);
      const ddg = await r.json();
      json = { organic: [{
        title: ddg.Heading,
        snippet: ddg.AbstractText,
        link: ddg.AbstractURL
      }]};
    }
    res.json(json);
  } catch (err) {
    console.error('Search proxy error', err);
    res.status(500).json({ error:'Search proxy error', details:err.message });
  }
});

// --- Perplexity Search Proxy Route (CORRECTED) ---
app.post('/myqa/perplexity/search', async (req, res) => {
  try {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      console.error('PERPLEXITY_API_KEY not set in .env for /myqa/perplexity/search');
      return res.status(500).json({ error: 'Configuration error: PERPLEXITY_API_KEY not set on server.' });
    }

    // Correct Perplexity API endpoint (no /v1/)
    const API_ENDPOINT = 'https://api.perplexity.ai/chat/completions';

    const { messages, stream } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Invalid request: 'messages' array is required for Perplexity search." });
    }

    // Always use a valid Perplexity model
    const perplexityPayload = {
      model: 'sonar',
      messages: messages,
      stream: stream !== undefined ? stream : false
    };

    console.log(`Sending request to Perplexity: ${API_ENDPOINT} with model ${perplexityPayload.model}`);

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(perplexityPayload)
    });

    const responseText = await response.text();
    let responseData;

    try {
      responseData = JSON.parse(responseText);
    } catch (jsonParseError) {
      // Handle non-JSON (e.g., HTML error page, empty 404)
      console.error('Non-JSON response from Perplexity:', {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        rawBody: responseText.substring(0, 500) + (responseText.length > 500 ? '...' : '')
      });
      return res.status(response.status || 502).json({
        error: `Non-JSON response from Perplexity. Status: ${response.status}`,
        details: 'The Perplexity API did not return valid JSON. This might happen with 404s or other server errors.',
        perplexity_status: response.status,
        perplexity_headers: Object.fromEntries(response.headers.entries()),
        perplexity_raw_body: responseText
      });
    }

    console.log(`Perplexity API response status: ${response.status}`);
    res.status(response.status).json(responseData);

  } catch (err) {
    console.error('Critical error in /myqa/perplexity/search proxy:', err);
    res.status(500).json({ error: 'Perplexity proxy internal server error', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server listening on http://localhost:${PORT}`);
}); 