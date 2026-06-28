#!/bin/bash
# End-to-end smoke test against a running local server (http://localhost:4004).
# Usage: bash test/e2e-verify.sh
set -u
BASE=http://localhost:4004
PASS=0; FAIL=0
check() { # name, expected, actual
  if [[ "$3" == *"$2"* ]]; then echo "PASS: $1"; PASS=$((PASS+1));
  else echo "FAIL: $1 — expected '$2' in: ${3:0:200}"; FAIL=$((FAIL+1)); fi
}

# 1. Unknown template -> TEMPLATE_NOT_FOUND
R=$(curl -s -X POST $BASE/api/v1/templates/does-not-exist/generate -H "Content-Type: application/json" -d '{"data":{}}')
check "TEMPLATE_NOT_FOUND" '"TEMPLATE_NOT_FOUND"' "$R"

# 2. Missing required field -> structured error
R=$(curl -s -X POST $BASE/api/v1/templates/invoice-standard/generate -H "Content-Type: application/json" -d '{"data":{"items":[]}}')
check "MISSING_REQUIRED_FIELD" '"MISSING_REQUIRED_FIELD"' "$R"
check "error details contain windowId" '"windowId"' "$R"

# 3. Get version ID for preview tests
VID=$(curl -s "$BASE/odata/v4/template/TemplateVersions?\$filter=status%20eq%20%27PUBLISHED%27&\$select=ID" | python3 -c "import sys,json;print(json.load(sys.stdin)['value'][0]['ID'])")
echo "versionId: $VID"

# 4. Preview without data -> uses sampleDataJson, returns base64 PDF
R=$(curl -s -X POST $BASE/api/v1/template-versions/$VID/preview -H "Content-Type: application/json" -d '{}')
check "preview uses sample data" '"status":"SUCCESS"' "$R"
echo "$R" | python3 -c "import sys,json,base64;d=json.load(sys.stdin);b=base64.b64decode(d['contentBase64']);print('preview pdf bytes:',len(b),b[:5])"

# 5. preview.html debug route
R=$(curl -s $BASE/api/v1/template-versions/$VID/preview.html)
check "preview.html contains customer" 'Musterkunde GmbH' "$R"

# 6. Lifecycle: createNewDraftVersion
TID=$(curl -s "$BASE/odata/v4/template/Templates?\$select=ID" | python3 -c "import sys,json;print(json.load(sys.stdin)['value'][0]['ID'])")
R=$(curl -s -X POST $BASE/odata/v4/template/createNewDraftVersion -H "Content-Type: application/json" -d "{\"templateId\":\"$TID\"}")
check "createNewDraftVersion -> version 2 DRAFT" '"version":2' "$R"
DRAFT_ID=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('ID',''))")

# 7. Editing the DRAFT is allowed
R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH $BASE/odata/v4/template/TemplateVersions\($DRAFT_ID\) -H "Content-Type: application/json" -d '{"sampleDataJson":"{}"}')
check "draft version editable (200)" '200' "$R"

# 8. Editing the PUBLISHED version is rejected
R=$(curl -s -X PATCH $BASE/odata/v4/template/TemplateVersions\($VID\) -H "Content-Type: application/json" -d '{"layoutJson":"{}"}')
check "published version locked (FORBIDDEN)" 'FORBIDDEN' "$R"

# 9. Publish the draft -> becomes active, old version archived
R=$(curl -s -X POST $BASE/odata/v4/template/publishTemplateVersion -H "Content-Type: application/json" -d "{\"templateVersionId\":\"$DRAFT_ID\"}")
check "publish draft -> PUBLISHED" '"status":"PUBLISHED"' "$R"
R=$(curl -s "$BASE/odata/v4/template/TemplateVersions(${VID})?\$select=status")
check "old version archived" 'ARCHIVED' "$R"
R=$(curl -s "$BASE/odata/v4/template/Templates(${TID})?\$select=activeVersion_ID")
check "active version switched" "$DRAFT_ID" "$R"

# 10. duplicateTemplate
R=$(curl -s -X POST $BASE/odata/v4/template/duplicateTemplate -H "Content-Type: application/json" -d "{\"templateId\":\"$TID\"}")
check "duplicateTemplate creates copy" 'invoice-standard-copy' "$R"

# 11. Generate again (now v2) and confirm logging
curl -s -X POST $BASE/api/v1/templates/invoice-standard/generate -H "Content-Type: application/json" \
  -d "{\"data\":$(cat srv/samples/invoice-data.json)}" > /dev/null
R=$(curl -s "$BASE/odata/v4/log/GenerationLogs?\$orderby=createdAt%20desc&\$top=3")
check "logs contain SUCCESS" '"status":"SUCCESS"' "$R"
check "logs contain ERROR entries" '"status":"ERROR"' "$R"
check "logs store durationMs" '"durationMs"' "$R"
R=$(curl -s "$BASE/odata/v4/log/GeneratedDocuments?\$top=2")
check "GeneratedDocuments recorded" 'invoice-9000001234.pdf' "$R"

echo "----------------------------------------"
echo "PASS=$PASS FAIL=$FAIL"
exit $FAIL
