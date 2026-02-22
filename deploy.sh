#!/bin/bash
set -e
echo "Deploying Chess App to AWS..."

# Navigate to infra directory
cd infra

# Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
    echo "Installing CDK dependencies..."
    npm install
fi

# Deploy
echo "Running CDK Deploy..."
npx aws-cdk deploy --require-approval never

echo "Deployment complete!"
