{
  "version": 2,
  "functions": {
    "api/generate.js": {
      "maxDuration": 60,
      "memory": 256
    },
    "api/cron-generate.js": {
      "maxDuration": 300,
      "memory": 256
    },
    "api/prompt-post.js": {
      "maxDuration": 30,
      "memory": 256
    }
  },
  "crons": [
    {
      "path": "/api/cron-generate",
      "schedule": "0 18 * * 0"
    }
  ]
}
