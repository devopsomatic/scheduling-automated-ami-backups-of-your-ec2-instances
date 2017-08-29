#!/bin/bash

aws iam create-role \
    --role-name ami-backup-role \
    --assume-role-policy-document file://./iam/role-trust-policy.json

aws iam attach-role-policy \
    --policy-arn ARN \
    --role-name ami-backup-role

aws lambda create-function \
    --function-name ami-backup-function \
    --runtime nodejs6.10 \
    --handler index.handler \
    --role ARN \
    --zip-file fileb://./build/dist/index.zip \
    --timeout 30

aws events put-rule \
    --name ami-backup-event-rule \
    --schedule-expression "rate(1 day)"
aws lambda add-permission \
    --function-name ami-backup-function \
    --statement-id LambdaPermission \
    --action "lambda:InvokeFunction" \
    --principal events.amazonaws.com \
    --source-arn ARN
aws events put-targets \
    --rule ami-backup-event-rule \
    --targets "Id"="1","Arn"="ARN"
