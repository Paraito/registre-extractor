# n8n Integration Guide

This guide explains how to integrate the Registre Extractor service with n8n workflows.

## Available Endpoints

The Registre Extractor API provides the following endpoints that can be used in n8n:

- `POST /api/extractions` - Create a new extraction job
- `GET /api/extractions/{id}` - Check extraction status
- `GET /api/extractions` - List all extraction jobs
- `POST /api/extractions/{id}/retry` - Retry a failed extraction
- `DELETE /api/extractions/{id}` - Cancel an extraction
- `GET /api/metrics` - Get system metrics
- `GET /api/workers` - Get worker status

## Example Workflows

### 1. Basic Extraction Workflow

This workflow triggers an extraction and waits for completion.

```json
{
  "name": "Quebec Registry Extraction",
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "http://localhost:3000/api/extractions",
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            {
              "name": "lot_number",
              "value": "={{ $json.lot_number }}"
            },
            {
              "name": "priority",
              "value": "normal"
            }
          ]
        }
      },
      "name": "Create Extraction Job",
      "type": "n8n-nodes-base.httpRequest",
      "position": [250, 300]
    },
    {
      "parameters": {
        "amount": 5,
        "unit": "seconds"
      },
      "name": "Wait",
      "type": "n8n-nodes-base.wait",
      "position": [450, 300]
    },
    {
      "parameters": {
        "method": "GET",
        "url": "=http://localhost:3000/api/extractions/{{ $node['Create Extraction Job'].json.extraction_id }}"
      },
      "name": "Check Status",
      "type": "n8n-nodes-base.httpRequest",
      "position": [650, 300]
    }
  ]
}
```

### 2. Batch Extraction with Error Handling

This workflow processes multiple lot numbers with error handling and retry logic.

```json
{
  "name": "Batch Registry Extraction",
  "nodes": [
    {
      "parameters": {
        "functionCode": "return items.map(item => ({\n  json: {\n    lot_number: item.json.lot_number,\n    priority: 'high'\n  }\n}));"
      },
      "name": "Prepare Lot Numbers",
      "type": "n8n-nodes-base.function",
      "position": [250, 300]
    },
    {
      "parameters": {
        "batchSize": 5
      },
      "name": "Split Into Batches",
      "type": "n8n-nodes-base.splitInBatches",
      "position": [450, 300]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "http://localhost:3000/api/extractions",
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            {
              "name": "lot_number",
              "value": "={{ $json.lot_number }}"
            },
            {
              "name": "priority",
              "value": "={{ $json.priority }}"
            }
          ]
        }
      },
      "name": "Create Extraction",
      "type": "n8n-nodes-base.httpRequest",
      "position": [650, 300]
    }
  ]
}
```

### 3. Monitoring Workflow

This workflow monitors extraction jobs and sends notifications for failures.

```json
{
  "name": "Extraction Monitor",
  "nodes": [
    {
      "parameters": {
        "triggerTimes": {
          "item": [
            {
              "mode": "everyX",
              "value": 5,
              "unit": "minutes"
            }
          ]
        }
      },
      "name": "Every 5 minutes",
      "type": "n8n-nodes-base.cron",
      "position": [250, 300]
    },
    {
      "parameters": {
        "method": "GET",
        "url": "http://localhost:3000/api/extractions?status=failed"
      },
      "name": "Get Failed Jobs",
      "type": "n8n-nodes-base.httpRequest",
      "position": [450, 300]
    },
    {
      "parameters": {
        "conditions": {
          "number": [
            {
              "value1": "={{ $json.total }}",
              "operation": "larger",
              "value2": 0
            }
          ]
        }
      },
      "name": "IF Failed Jobs",
      "type": "n8n-nodes-base.if",
      "position": [650, 300]
    }
  ]
}
```

## Using with Supabase

You can combine the Registre Extractor with Supabase nodes to:

1. Read property records from Supabase
2. Trigger extractions for each property
3. Update Supabase with the extracted document URLs

Example workflow:

```json
{
  "name": "Supabase Property Extraction",
  "nodes": [
    {
      "parameters": {
        "operation": "getAll",
        "table": "properties",
        "filters": {
          "conditions": [
            {
              "field": "needs_extraction",
              "condition": "eq",
              "value": true
            }
          ]
        }
      },
      "name": "Get Properties",
      "type": "n8n-nodes-base.supabase",
      "position": [250, 300]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "http://localhost:3000/api/extractions",
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            {
              "name": "lot_number",
              "value": "={{ $json.lot_number }}"
            },
            {
              "name": "metadata",
              "value": "={{ { property_id: $json.id } }}"
            }
          ]
        }
      },
      "name": "Create Extraction",
      "type": "n8n-nodes-base.httpRequest",
      "position": [450, 300]
    }
  ]
}
```

## Webhook Integration

The API can also send webhook notifications when extractions complete. Configure your extraction request with a webhook URL:

```json
{
  "lot_number": "2 784 195",
  "priority": "high",
  "webhook": {
    "url": "https://your-n8n-instance.com/webhook/extraction-complete",
    "headers": {
      "Authorization": "Bearer your-token"
    }
  }
}
```

## Best Practices

1. **Batch Processing**: Process lot numbers in batches to avoid overwhelming the system
2. **Error Handling**: Always implement error handling and retry logic
3. **Rate Limiting**: Respect the system's capacity (20 concurrent extractions)
4. **Monitoring**: Set up monitoring workflows to track failed jobs
5. **Priority Management**: Use priority levels appropriately (low, normal, high)

## Environment Variables for n8n

Add these to your n8n environment:

```env
REGISTRE_EXTRACTOR_API_URL=http://localhost:3000
REGISTRE_EXTRACTOR_API_KEY=your-api-key-if-configured
```