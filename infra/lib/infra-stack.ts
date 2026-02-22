import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { WebSocketApi, WebSocketStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as path from 'path';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create an S3 bucket to hold the website content
    const websiteBucket = new s3.Bucket(this, 'ChessWebsiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production, but good for demos
      autoDeleteObjects: true, // Only for demo/dev stacks
    });

    // Create a CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'ChessWebsiteDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
    });

    // --- Cognito Setup ---

    const userPool = new cognito.UserPool(this, 'ChessUserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY, 
    });

    const userPoolDomain = userPool.addDomain('ChessAuthDomain', {
      cognitoDomain: {
        domainPrefix: `chess-app-${this.account}`, // Unique prefix
      },
    });

    // Reference an existing secret in Secrets Manager
    const googleClientSecret = secretsmanager.Secret.fromSecretNameV2(this, 'GoogleClientSecret', 'prod/GoogleOAuthSecretChessGame');

    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
      userPool,
      // Use the 'chess-app/google-client-id' key from the same secret
      clientId: googleClientSecret.secretValueFromJson('chess-app/google-client-id').unsafeUnwrap(),
      clientSecretValue: googleClientSecret.secretValueFromJson('chess-app/google-client-secret'),
      attributeMapping: {
        email: cognito.ProviderAttribute.GOOGLE_EMAIL,
        givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
        familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        profilePicture: cognito.ProviderAttribute.GOOGLE_PICTURE,
      },
      scopes: ['profile', 'email', 'openid'],
    });

    const userPoolClient = userPool.addClient('ChessUserPoolClient', {
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.GOOGLE,
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
      oAuth: {
        flows: {
          implicitCodeGrant: true, // Implicit grant is simplest for static sites
        },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: [
          `https://${distribution.distributionDomainName}/index.html`,
          `https://${distribution.distributionDomainName}/`,
          `https://${distribution.distributionDomainName}`
        ],
        logoutUrls: [
          `https://${distribution.distributionDomainName}/index.html`,
          `https://${distribution.distributionDomainName}/`,
          `https://${distribution.distributionDomainName}`
        ],
      },
    });

    // Ensure the provider is created before the client
    userPoolClient.node.addDependency(googleProvider);

    // --- End Cognito Setup ---

    // --- Start Game History Backend ---

    // DynamoDB Table
    const gamesTable = new dynamodb.Table(this, 'GamesTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gameId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev purposes, destroy table on stack deletion
    });

    // Lambda Function
    const gameHandler = new lambda.Function(this, 'GameHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/game-handler')),
      environment: {
        TABLE_NAME: gamesTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
    });

    // Grant Lambda permission to access DynamoDB
    gamesTable.grantReadWriteData(gameHandler);

    // API Gateway Authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'GameAuthorizer', {
      cognitoUserPools: [userPool],
    });

    // API Gateway
    const api = new apigateway.LambdaRestApi(this, 'GameApi', {
      handler: gameHandler,
      proxy: false, // We define resources explicitly
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    const gamesResource = api.root.addResource('games');
    
    // GET /games - List games
    gamesResource.addMethod('GET', new apigateway.LambdaIntegration(gameHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /games - Save game
    gamesResource.addMethod('POST', new apigateway.LambdaIntegration(gameHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // --- End Game History Backend ---

    // --- Start WebSocket Multiplayer Backend ---

    const activeGamesTable = new dynamodb.Table(this, 'ActiveGamesTable', {
      partitionKey: { name: 'gameId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const websocketHandler = new lambda.Function(this, 'WebSocketHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/websocket-handler')),
      environment: {
        ACTIVE_GAMES_TABLE: activeGamesTable.tableName,
        CONNECTIONS_TABLE: connectionsTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
    });

    activeGamesTable.grantReadWriteData(websocketHandler);
    connectionsTable.grantReadWriteData(websocketHandler);

    // WebSocket API
    const webSocketApi = new WebSocketApi(this, 'ChessWebSocketApi', {
      apiName: 'ChessWebSocketApi',
    });

    webSocketApi.addRoute('$connect', {
      integration: new WebSocketLambdaIntegration('ConnectIntegration', websocketHandler),
    });
    webSocketApi.addRoute('$disconnect', {
      integration: new WebSocketLambdaIntegration('DisconnectIntegration', websocketHandler),
    });
    webSocketApi.addRoute('createGame', {
      integration: new WebSocketLambdaIntegration('CreateGameIntegration', websocketHandler),
    });
    webSocketApi.addRoute('joinGame', {
      integration: new WebSocketLambdaIntegration('JoinGameIntegration', websocketHandler),
    });
    webSocketApi.addRoute('listGames', {
      integration: new WebSocketLambdaIntegration('ListGamesIntegration', websocketHandler),
    });
    webSocketApi.addRoute('move', {
      integration: new WebSocketLambdaIntegration('MoveIntegration', websocketHandler),
    });
    
    // Grant Lambda permission to Manage Connections (PostToConnection)
    const webSocketStage = new WebSocketStage(this, 'WebSocketStage', {
      webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });
    
    webSocketApi.grantManageConnections(websocketHandler);

    // Explicitly grant invoke permissions for all routes (to fix potential 500 errors)
    // In a production app, these should be more granularly scoped.
    // However, the grantManageConnections above handles the generic permission.
    // The specific route permissions are implicitly handled by the integration but seemingly failed before.
    // The issue might have been resolved by simply redeploying the route integrations with specific IDs.
    // For safety, ensuring the permission logic is sound. API Gateway routes need permission to invoke the Lambda.
    // The 'WebSocketLambdaIntegration' construct usually adds this permission. 
    // If we want to be explicit:
    
    /*
    const routes = ['$connect', '$disconnect', 'createGame', 'joinGame', 'move', 'listGames'];
    routes.forEach(route => {
        websocketHandler.addPermission(`Invoke${route.replace('$', '')}`, {
            principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
            sourceArn: webSocketApi.arnForExecuteApi(route)
        });
    });
    */

    // --- End WebSocket Multiplayer Backend ---

    // Create a config object with the values we need
    const config = {
      cognitoDomain: userPoolDomain.baseUrl(), // automatically includes https://
      clientId: userPoolClient.userPoolClientId,
      apiUrl: api.url,
      wsUrl: webSocketStage.url, // e.g. wss://xxx.execute-api.eu-central-1.amazonaws.com/prod
    };

    // Deploy the website content to the S3 bucket
    // Since the CDK code is in 'infra/lib', we go up 2 levels to reach the project root
    new s3deploy.BucketDeployment(this, 'DeployChessWebsite', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '../../'), {
          exclude: ['infra', 'infra/*', '.git', '.git/*', '.DS_Store', 'node_modules', 'node_modules/*'] 
        }),
        // Add dynamic config.js
        s3deploy.Source.jsonData('config.json', config),
      ],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // Output the CloudFront URL
    new cdk.CfnOutput(this, 'WebsiteURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'The URL of the chess website',
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'CognitoDomain', { value: userPoolDomain.baseUrl() });
  }
}

