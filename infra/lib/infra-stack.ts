import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
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

    // Create a config object with the values we need
    const config = {
      cognitoDomain: userPoolDomain.baseUrl(), // automatically includes https://
      clientId: userPoolClient.userPoolClientId,
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

