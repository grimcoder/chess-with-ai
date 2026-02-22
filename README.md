# Serverless Chess vs AI

A fully serverless Chess application where you can play against an AI opponent (Minimax algorithm), sign in with your Google account, and save your game history to the cloud.

## Features

*   **Real-Time Multiplayer**: Challenge friends online with live move updates via WebSockets.
*   **Cross-Platform**: Play seamlessly between Web and Mobile (React Native) clients.
*   **AI Opponent**: Play against a configurable AI difficulty (Minimax with Alpha-Beta Pruning).
*   **Lobby System**: Browse and join available games from a dynamic list.
*   **Authentication**: Secure login via Google (Amazon Cognito).
*   **Cloud Persistence**: Game history is automatically saved to DynamoDB upon Checkmate or Draw.
*   **Game Replay**: Review past games move-by-move.
*   **Serverless Architecture**: Scales automatically with zero server management.

## Architecture

*   **Frontend**: 
    *   **Web**: Static website (HTML/CSS/JS) hosted on **Amazon S3** distributed via **Amazon CloudFront**.
    *   **Mobile**: React Native (Expo) app for iOS and Android.
*   **Auth**: **Amazon Cognito User Pool** with Google Identity Provider.
*   **API**: 
    *   **REST API**: Amazon API Gateway for game history.
    *   **WebSocket API**: Amazon API Gateway for real-time player moves.
*   **Compute**: **AWS Lambda** (Node.js) for backend logic (AI, History, WebSocket Handler).
*   **Database**: **Amazon DynamoDB** (3 Tables):
    *   `GamesTable`: Historical game records (Partition Key: `userId`, Sort Key: `gameId`).
    *   `ActiveGamesTable`: Current live game state (Partition Key: `gameId`).
    *   `ConnectionsTable`: Active WebSocket connections (Partition Key: `connectionId`).
*   **Infrastructure**: Defined entirely in **AWS CDK** (TypeScript).

## Prerequisites

1.  **AWS Account**: An active AWS account with CLI configured.
2.  **Node.js**: v18 or later.
3.  **AWS CDK**: Install globally (`npm install -g aws-cdk`).
4.  **Google Cloud Console**: A project with OAuth 2.0 credentials.

## Cloud Persistence

Games played against the AI are automatically saved to your history when they end (Checkmate or Draw), provided you are logged in.

## Real-Time Multiplayer

1.  Click **"Play Online"**.
2.  **Create Game**: Generates a Game ID to share. Wait for an opponent.
3.  **Join Game**: Enter the opponent's Game ID to join.
4.  Moves are synchronized instantly via WebSockets.

## Step-by-Step Deployment Guide

### 1. Google OAuth Setup

1.  Go to the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2.  Create new OAuth 2.0 Client ID credentials (Web Application).
3.  Get your **Client ID** and **Client Secret**.
    *   *Note: You will need to come back here later to add the Authorized Redirect URIs once Cognito is deployed.*

### 2. Configure AWS Secrets Manager

The CDK stack retrieves Google credentials from Secrets Manager to configure Cognito.

1.  Go to **AWS Secrets Manager** in your desired region (e.g., `eu-central-1`).
2.  Create a **new secret**.
    *   Select **"Other type of secret"**.
    *   Add Key/Value pairs:
        *   `clientId`: `<Your Google Client ID>`
        *   `clientSecret`: `<Your Google Client Secret>`
    *   Click Next.
    *   **Secret Name**: `prod/GoogleOAuthSecretChessGame`
    *   Finish creating the secret.

### 3. Deploy Infrastructure

1.  Clone this repository.
2.  Install project dependencies:
    ```bash
    npm install
    # Install backend dependencies if needed (though Lambda uses SDK v3 built-in)
    ```
3.  Deploy using the provided script (or `cdk deploy` manually):
    ```bash
    ./deploy.sh
    ```
    *This will package the website, provision Cognito, DynamoDB, API Gateway, and CloudFront.*

### 4. Final Configuration

After deployment, the CDK output will provide two important URLs:
*   `WebsiteURL`: The CloudFront URL (e.g., `https://dxxxxx.cloudfront.net`).
*   `CognitoDomain`: The auth domain (e.g., `https://chess-app-<account>...`).

1.  **Update Google Console**:
    *   Go back to your Google OAuth Client settings.
    *   Add the **Cognito Domain** + `/oauth2/idpresponse` to **Authorized Redirect URIs**.
        *   Example: `https://chess-app-123456789.auth.eu-central-1.amazoncognito.com/oauth2/idpresponse`
    *   Add the **WebsiteURL** to **Authorized JavaScript Origins** (optional but recommended).

2.  **Verify**:
    *   Open the `WebsiteURL` in your browser.
    *   Click "Login with Google".
    *   Play a game!

## Mobile Client (React Native)

The project includes a React Native mobile client located in the `mobile` directory. It connects to the same serverless backend, allowing cross-platform multiplayer games (Web vs Mobile).

### Prerequisites
*   **Node.js**: LTS version (v18+).
*   **Expo Go App**: Install "Expo Go" on your iOS or Android device from the App Store or Google Play Store.

### Setup & Run
1.  Navigate to the mobile directory:
    ```bash
    cd mobile
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the development server:
    ```bash
    npx expo start
    ```
4.  **Connect Device**:
    *   Scan the QR code displayed in the terminal using the Expo Go app (Android) or Camera app (iOS).
    *   Ensure your phone and computer are on the same Wi-Fi network.

### Troubleshooting
*   If connection fails, try running `npx expo start --tunnel`.
*   Ensure the backend is deployed and the `mobile/App.js` configuration matches your API Gateway WebSocket URL (currently hardcoded as `CONFIG.wsUrl`, or automatically updated if implemented).

## Local Development

*   **Frontend**: You can run a local server (e.g., `python3 -m http.server 8000`), but authentication flows require the authorized redirect URIs to match. It is recommended to deploy to AWS for full functionality.
*   **Backend**: Lambda functions are in `infra/lambda/`.
*   **Infrastructure**: Defined in `infra/lib/infra-stack.ts`.

## Cleanup

To remove all resources and avoid costs:

```bash
cd infra
cdk destroy
```
