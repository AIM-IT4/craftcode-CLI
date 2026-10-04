export default {
  name: 'word-count',
  description: 'Example lazy local plugin.',
  tools: [{
    definition: {
      type: 'function',
      function: {
        name: 'count_words',
        description: 'Count whitespace-delimited words.',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false
        }
      }
    },
    execute: async ({ text }) => ({
      words: text.trim() ? text.trim().split(/\s+/).length : 0
    })
  }]
};
