const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const gcp = require("@pulumi/gcp");

const vpcCIDRBlock = new pulumi.Config("db_vpc").require("cidrBlock");
const publicRouteTableCIDRBlock = new pulumi.Config("db_publicRouteTable").require("cidrBlock");
const region = new pulumi.Config("aws").require("region");
const db_keyName = new pulumi.Config("db_vpc").require("key");
const dbName = new pulumi.Config("dbName").require("name");
const dbPassword = new pulumi.Config("dbPassword").require("password");
const dbUserName = new pulumi.Config("dbUserName").require("user");
const db_ami = "ami-0cfb24bc964e31407";
const domainName = new pulumi.Config("dbDomainName").require("domainName");
const myLambdaPath = "C:/Users/bhakt/OneDrive/Desktop/BhaktiBharatDesai_002701264_09/serverless.zip"
const myGcpProjectID = new pulumi.Config("gcp").require("project");


//ami
// const db_ami = getLatestAmi('us-east-1');
// const db_ami = pulumi.output(
//     aws.ec2.getAmi({
//       mostRecent: true,
//       owners: [myAmiOwner],
//     })
//   );

// GCP Bucket
const myGcpBucket = new gcp.storage.Bucket("my-webapp-gcp-bucket", {
  location: "US", 
  project: myGcpProjectID,
  forceDestroy: true,
});

//service account
const myServiceAccount = new gcp.serviceaccount.Account(
    "my-webapp-service-account",
    {
      accountId: "my-webapp-service-account",
      displayName: "My webapp Service Account",
      project: myGcpProjectID,
    }
  );

  //Service Account Key
  const myServiceAccountKey = new gcp.serviceaccount.Key(
    "my-webapp-service-account-key",
    {
      serviceAccountId: myServiceAccount.name,
    }
  );

  //gcp role
  const myGcpStorageAdminRole = new gcp.projects.IAMMember(
    "gcp-storage-admin-role",
    {
      member: myServiceAccount.email.apply((email) => `serviceAccount:${email}`),
      role: "roles/storage.admin",
      project: myGcpProjectID,
    }
  );

// Function for AWS availability zones
const getAvailableAvailabilityZones = async () => {
    const zones = await aws.getAvailabilityZones({ state: "available" });
    const i = Math.min(zones.names.length, 3);
    console.log('zones now: ', i);
    return zones.names.slice(0, i);
};

//calculate CIDR for subnets
const calculateSubnetCIDRBlock = (baseCIDRBlock, index) => {
    const subnetMask = 24; // Adjust the subnet mask as needed
    const baseCIDRParts = baseCIDRBlock.split("/");
    const networkAddress = baseCIDRParts[0].split(".");
    const newSubnetAddress = `${networkAddress[0]}.${networkAddress[1]}.${index}.${networkAddress[2]}`;
    return `${newSubnetAddress}/${subnetMask}`;
};

//Virtual Private Cloud (VPC)
const db_vpc = new aws.ec2.Vpc("db_vpc", {
    cidrBlock: vpcCIDRBlock,
    instanceTenancy: "default",
    tags: {
        Name: "db_vpc",
    },
});

// availability zones
const createSubnets = async () => {
    const availabilityZones = await getAvailableAvailabilityZones();
    // Internet Gateway and attaching it to the VPC
    const db_internetGateway = new aws.ec2.InternetGateway("db_internetGateway", {
        vpcId: db_vpc.id,
        tags: {
            Name: "db_internetGateway",
        },
    });

    // Public route table and associate all public subnets
    const db_publicRouteTable = new aws.ec2.RouteTable("db_publicRouteTable", {
        vpcId: db_vpc.id,
        routes: [
            {
                cidrBlock: publicRouteTableCIDRBlock, // The destination CIDR block for the internet
                gatewayId: db_internetGateway.id, // The internet gateway as the target
            },
        ],
        tags: {
            Name: "db_publicRouteTable",
        },
    });

    // Public route in the public route table with the internet gateway as the target
    const publicRoute = new aws.ec2.Route("publicRoute", {
        routeTableId: db_publicRouteTable.id,
        destinationCidrBlock: publicRouteTableCIDRBlock,
        gatewayId: db_internetGateway.id,
    });

    const db_publicSubnets = [];
    const db_privateSubnets = [];

    for (let i = 0; i < availabilityZones.length; i++) {
        // Calculate the CIDR block for public and private subnets
        const publicSubnetCIDRBlock = calculateSubnetCIDRBlock(vpcCIDRBlock, i + 10);
        const privateSubnetCIDRBlock = calculateSubnetCIDRBlock(vpcCIDRBlock, i + 15);


        // Create public subnet
        const publicSubnet = new aws.ec2.Subnet(`db_publicSubnet${i + 1}`, {
            vpcId: db_vpc.id,
            availabilityZone: availabilityZones[i],
            cidrBlock: publicSubnetCIDRBlock,
            mapPublicIpOnLaunch: true,
            tags: {
                Name: `db_publicSubnet${i + 1}`,
            },
        });
        db_publicSubnets.push(publicSubnet);

        // Create private subnet
        const privateSubnet = new aws.ec2.Subnet(`db_privateSubnet${i + 1}`, {
            vpcId: db_vpc.id,
            availabilityZone: availabilityZones[i],
            cidrBlock: privateSubnetCIDRBlock,
            tags: {
                Name: `db_privateSubnet${i + 1}`,
            },
        });
        db_privateSubnets.push(privateSubnet);
    }

      // Create a security group for the load balancer
      const loadBalancerSecurityGroup = new aws.ec2.SecurityGroup("loadBalancerSecurityGroup", {
        vpcId: db_vpc.id,
        ingress: [
            // {
            //     protocol: "tcp",
            //     fromPort: 80,
            //     toPort: 80,
            //     cidrBlocks: ["0.0.0.0/0"]
            // },
            {
                protocol: "tcp",
                fromPort: 443,
                toPort: 443,
                cidrBlocks: ["0.0.0.0/0"]
            },
        ],
        tags: {
            Name: "LoadBalancerSecurityGroup"
        },
    });


    // EC2 Security Group for Web Applications
    const appSecurityGroup = new aws.ec2.SecurityGroup("appSecurityGroup", {
        vpcId: db_vpc.id,
        ingress: [
            {
                fromPort: 22,
                toPort: 22,
                protocol: "tcp",
                securityGroups: [loadBalancerSecurityGroup.id],
                // cidrBlocks: ["0.0.0.0/0"], // Allow SSH from anywhere
            },
            // {
            //     fromPort: 80,
            //     toPort: 80,
            //     protocol: "tcp",
            //     cidrBlocks: ["0.0.0.0/0"], // Allow HTTP from anywhere
            // },
            // {
            //     fromPort: 443,
            //     toPort: 443,
            //     protocol: "tcp",
            //     cidrBlocks: ["0.0.0.0/0"], // Allow HTTPS from anywhere
            // },
            {
                fromPort: 3000,
                toPort: 3000,
                protocol: "tcp",
                // cidrBlocks: ["0.0.0.0/0"],
                securityGroups: [loadBalancerSecurityGroup.id],
            }
        ],
        egress: [
            {
                protocol: "-1", // -1 means all protocols
                fromPort: 0,
                toPort: 0, // Set both fromPort and toPort to 0 to allow all ports
                cidrBlocks: ["0.0.0.0/0"],
            },
        ],
        tags: {
            Name: "appSecurityGroup",
        },
    });
    
    let loadbalancerEgressRule = new aws.ec2.SecurityGroupRule("myloadbalancerEgressRule", {
        type: "egress",
        securityGroupId: loadBalancerSecurityGroup.id,
        protocol: "tcp",
        fromPort: 3000,
        toPort: 3000,
        sourceSecurityGroupId: appSecurityGroup.id
      });

    for (let i = 0; i < db_publicSubnets.length; i++) {
        new aws.ec2.RouteTableAssociation(`db_publicRouteTableAssociation-${i}`, {
            subnetId: db_publicSubnets[i].id,
            routeTableId: db_publicRouteTable.id,
        });
    }
    // Create a private route table and associate all private subnets
    const db_privateRouteTable = new aws.ec2.RouteTable("db_privateRouteTable", {
        vpcId: db_vpc.id,
        tags: {
            Name: "db_privateRouteTable",
        },
    });
    for (let i = 0; i < db_privateSubnets.length; i++) {
        new aws.ec2.RouteTableAssociation(`db_privateRouteTableAssociation-${i}`, {
            subnetId: db_privateSubnets[i].id,
            routeTableId: db_privateRouteTable.id,
        });
    }

    // Create a security group for RDS instances
    const databaseSecurityGroup = new aws.ec2.SecurityGroup("databaseSecurityGroup", {
        vpcId: db_vpc.id,
        ingress: [
            // Add ingress rule for your application port
            {
                fromPort: 3306,
                toPort: 3306,
                protocol: "tcp",
                securityGroups: [appSecurityGroup.id],
                // cidrBlocks: ["0.0.0.0/0"]
            },
        ],
        egress: [
             // Add egress rule for your application port
             {
                fromPort: 3306,
                toPort: 3306,
                protocol: "tcp",
                securityGroups: [appSecurityGroup.id],
                // cidrBlocks: ["0.0.0.0/0"]
            },
        ]
    });
    await databaseSecurityGroup.id;
    pulumi.log.info(
        pulumi.interpolate`Database Security Group VPC ID: ${databaseSecurityGroup.id}`
    );

// Create an RDS parameter group
    const rdsParameterGroup = new aws.rds.ParameterGroup("myRdsParameterGroup", {
        vpcId: db_vpc.id,
        family: "mariadb10.6", // Change this to match your database engine and version
        name: "my-rds-parameter-group",
        parameters: [
            {
                name: "character_set_server",
                value: "utf8",
            },
            {
                name: "collation_server",
                value: "utf8_general_ci",
            },
        ],
        tags: {
            Name: "myRdsParameterGroup",
        },
    });

    const rdsSubnetGroup = new aws.rds.SubnetGroup("rds_subnet_group", {
                subnetIds: db_privateSubnets.map(subnet => subnet.id),
                tags: {
                    Name: "rdsSubnetGroup", // You can name it as desired
                },
            });

 //RDS instance creation starts here...
    const rdsInstance = new aws.rds.Instance("rds-instance", {
        allocatedStorage: 20,
        storageType: "gp2",
        multiAz: false,
        parameterGroupName: rdsParameterGroup.name,
        identifier: "csye6225",
        engine: "mariadb",
        instanceClass: "db.t2.micro", // Choose the cheapest instance class
        username: "root",
        password: "root#123",
        skipFinalSnapshot: true, // To avoid taking a final snapshot when deleting the RDS instance
        publiclyAccessible: false, // Ensure it's not publicly accessible
        dbSubnetGroupName: rdsSubnetGroup.name,
        vpcSecurityGroupIds: [databaseSecurityGroup.id], //ec2Instance.id.vpcSecurityGroupIds --> this does not attach the databseSecurityGroup, 
        // Attach the security group
        // subnetIds: db_privateSubnets.map(subnet => subnet.id), // Use private subnets
        dbName: "csye6225", // Database name
        tags: {
            Name: "rds-db-instance",
        },
    });
    pulumi.log.info(
        pulumi.interpolate`RDS instance id: ${rdsInstance.id}`
    );

    // user database configuration
    const DB_HOST = pulumi.interpolate`${rdsInstance.address}`;
    // User data script to configure the EC2 instance

       // #region AWS Dynamo DB
  const myAwsDynamoDb = new aws.dynamodb.Table("my-Aws-Dynamo-Tracker", {
    attributes: [
        { name: "Id", type: "S" },
        { name: "ReceiverEmail", type: "S" },
        { name: "EmailBody", type: "S" },
        { name: "status", type: "S" }
    ],
    hashKey: "Id",
    globalSecondaryIndexes: [
      {
          name: "ReceiverEmail",
          hashKey: "ReceiverEmail",
          projectionType: "ALL"
      },
      {
          name: "EmailBody",
          hashKey: "EmailBody",
          projectionType: "ALL"
      },
      {
          name: "status",
          hashKey: "status",
          projectionType: "ALL"
      }
    ],
    billingMode: "PAY_PER_REQUEST"
});
// #endregion  

//sns topic
const mySnsTopic = new aws.sns.Topic("my-sns-topic", {
    displayName: "My AWS SNS",
  });

//lambda function
// const myCloudWatchAction = "cloudwatch:GetMetricStatistics"; 
// const myCloudWatchVersion = "2012-10-17";
  const lambdaFunctionRole = new aws.iam.Role("my-Lambda-Function-Role", {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: {
            Service: "lambda.amazonaws.com",
          },
        },
      ],
    }),
    tags: {
      "my-Lambda-Function-Role": "my-Lambda-Function-Role",
    },
  });

  const lambdaAWSLambdaBasicExecutionRolePolicyAttachment =
  new aws.iam.PolicyAttachment(
    "Lambda-Basic-Execution-Role-Policy-Attachment",
    {
      policyArn:
        "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
      roles: [lambdaFunctionRole.name],
    }
  );

const lambdaAWSLambdaRolePolicyAttachment = new aws.iam.PolicyAttachment(
  "lambdaAWSLambdaRolePolicyAttachment",
  {
    policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaRole",
    roles: [lambdaFunctionRole.name],
  }
);

const cloudWatchAgentAdminPolicyAttachment = new aws.iam.PolicyAttachment(
    "Lambda-AWS-Lambda-Role-Policy-Attachment",
    {
      policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentAdminPolicy",
      roles: [lambdaFunctionRole.name],
    }
  );


  const AmazonEC2RoleforSSMPolicyAttachment = new aws.iam.PolicyAttachment(
    "AmazonEC2RoleforSSMPolicyAttachment",
    {
        policyArn: "arn:aws:iam::aws:policy/service-role/AmazonEC2RoleforSSM",
      roles: [lambdaFunctionRole.name],
    }
  );
 

const dynamoDBPolicy = new aws.iam.Policy("DynamoDB-Policy", {
    name: "DynamoDB-Policy",
    policy: {
        Version: "2012-10-17",
        Statement: [
            {
              Effect: "Allow",  
              Action: [
                "dynamodb:PutItem"
              ],
              Resource: [
                myAwsDynamoDb.arn
              ],
            },              
        ],
    },
});

const dynamoDBPolicyAttachment = new aws.iam.PolicyAttachment("DynamoDB-Policy-Attachment", {
    policyArn: dynamoDBPolicy.arn,
    roles: [lambdaFunctionRole.name],
});

const mydomain = "dbwebapp.me"
const myLambdaFunction = new aws.lambda.Function(
    "my-webapp-lambda-function",
    {
      code: new pulumi.asset.AssetArchive({
        ".": new pulumi.asset.FileArchive(
          myLambdaPath
        ),
      }),
      role: lambdaFunctionRole.arn,
      handler: "index.handler",
      runtime: "nodejs18.x",
      environment: {
        variables: {
          GCS_BUCKET: myGcpBucket.name,
          GOOGLE_CREDENTIALS: myServiceAccountKey.privateKey,
          API_KEY: "a650634d76bdfb7c76869df457b83c0e-30b58138-d685780d",
          DOMAIN: mydomain,
          DYNAMO_DB_NAME: myAwsDynamoDb.name
        },
      },
    }
  );

  const myLambdaPermission = new aws.lambda.Permission("my-lambda-permission", {
    action: "lambda:InvokeFunction",
    function: myLambdaFunction,
    principal: "s3.amazonaws.com",
    sourceArn: mySnsTopic.arn,
  });

  const snsSubscription = mySnsTopic.onEvent("my-sns-subscription", myLambdaFunction);
 
    const userData = pulumi.interpolate`#!/bin/bash
    # Define the path to the .env file
    envFile="/opt/csye6225/bhaktidesai_002701264_05/.env"
    # Check if the .env file exists
    if [ -e "$envFile" ]; then
      # If it exists, remove it
      sudo rm "$envFile"
    fi
    # Create the .env file
    sudo touch "$envFile"
    echo "DB_NAME='${rdsInstance.dbName}'" | sudo tee -a "$envFile"
    echo "DB_HOST='${DB_HOST}'" | sudo tee -a "$envFile"
    echo "DB_USERNAME='${rdsInstance.username}'" | sudo tee -a "$envFile"
    echo "DB_PASSWORD='${rdsInstance.password}'" | sudo tee -a "$envFile"
    echo "PORT='3306'" | sudo tee -a "$envFile"
    echo "TOPIC_ARN='${mySnsTopic.arn}'" | sudo tee -a "$envFile"
    sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/csye6225/bhaktidesai_002701264_05/amazon-cloudwatch-agent.json
    sudo systemctl enable amazon-cloudwatch-agent
    sudo systemctl start amazon-cloudwatch-agent`;
    pulumi.log.info(
        pulumi.interpolate`DB data: DB_HOST, userDataScript - ${DB_HOST}, ${userData}`
    );

    const userDataBase64 = pulumi.output(userData).apply(userData => Buffer.from(userData).toString('base64'));

    // const ami = pulumi.output(
    //     aws.ec2.getAmi({
    //       mostRecent: true,
    //       owners: [myAmiOwner],
    //     })
    //   );

    // Create IAM Role for CloudWatch Agent
    const ec2CloudWatch = new aws.iam.Role("ec2CloudWatch", {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Principal: {
                    Service: "ec2.amazonaws.com",
                },
            }],
            // name: "db_IAMrole",
        }),
    });
 
    // Attach AmazonCloudWatchAgentServerPolicy to the IAM role
    const cloudWatchAgentPolicyAttachment = new aws.iam.RolePolicyAttachment("CloudWatchAgentPolicyAttachment", {
        role: ec2CloudWatch,
        policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
    });

    let instanceProfile = new aws.iam.InstanceProfile("myInstanceProfile", {
        role: ec2CloudWatch.name
    });

    const awsSNStoEC2PolicyAttachment = new aws.iam.PolicyAttachment(
        "AWS-SNS-to-EC2-Policy-Attachment",
        {
          policyArn: "arn:aws:iam::aws:policy/service-role/AWSIoTDeviceDefenderPublishFindingsToSNSMitigationAction",
          roles: [ec2CloudWatch.name],
        }
      );

    // // EC2 Instance
    // const ec2Instance = new aws.ec2.Instance("ec2Instance", {
    //     instanceType: "t2.micro", // Set the desired instance type
    //     ami: db_ami, // Replace with your custom AMI ID
    //     vpcSecurityGroupIds: [appSecurityGroup.id],
    //     subnetId: db_publicSubnets[0].id, // Choose one of your public subnets
    //     vpcId: db_vpc.id,
    //     keyName: db_keyName,
    //     rootBlockDevice: {
    //         volumeSize: 25,
    //         volumeType: "gp2",
    //     },
    //     protectFromTermination: false,
    //     userData: userData, // Attach the user data script
    //     tags: {
    //         Name: "db_EC2Instance",
    //     },
    //     iamInstanceProfile: instanceProfile.name,
    // });


 // AutoScaling Code starts here...
 
    // Launch Template for Auto Scaling Group
    const webAppLaunchTemplate = new aws.ec2.LaunchTemplate("webAppLaunchTemplate", {
        vpcId: db_vpc.id,
        securityGroups: [appSecurityGroup.id],
        vpcSecurityGroupIds: [appSecurityGroup.id],
        imageId: db_ami,
        instanceType: "t2.micro",
        keyName: db_keyName,
        userData: userDataBase64,
        iamInstanceProfile: {name: instanceProfile.name},
        associatePublicIpAddress: false,
        rootBlockDevice: {
            volumeSize: 25,
            volumeType: "gp2",
            deleteOnTermination: true,
        },
        tags: {
            Name: "EC2Instance",
        },
    });

    // Create a target group for the ALB
    const appTargetGroup = new aws.lb.TargetGroup("webAppTargetGroup", {
        port: 3000, //Application port goes here
        protocol: "HTTP",
        targetType: "instance",
        vpcId: db_vpc.id,
        healthCheck: {
            path: "/healthz",
            port: 3000,
            protocol: "HTTP",
            interval: 30,
            timeout: 10,
            unhealthyThreshold: 2,
            healthyThreshold: 2,
        },
    });
    
    // Auto Scaling Group
    const autoScalingGroup = new aws.autoscaling.Group("webAppAutoScalingGroup", {
        // availabilityZones: availabilityZones,
        vpcZoneIdentifiers: db_publicSubnets.map(s => s.id),
        healthCheckType: "EC2",
        desiredCapacity: 1,
        maxSize: 3,
        minSize: 1,
        cooldown: 60,
        iamInstanceProfile: {id: instanceProfile.id, version: "$Latest",},
        waitForCapacityTimeout: "0",
        protectFromScaleIn: false,
        launchTemplate: {
            id: webAppLaunchTemplate.id,
          },
          tagSpecifications: [
            {
              resourceType: "instance",
              tags: [
                {
                  key: "Name",
                  value: "WebAppInstance"
                }
              ]  
            }
          ],
          targetGroupArns: [appTargetGroup.arn], // associate with the ALB target group
          instanceRefresh: {
              strategy: "Rolling",
              preferences: {
                  minHealthyPercentage: 90,
                  instanceWarmup: 60,
              },
          },
          forceDelete: true
    });

    // Auto Scaling Policies
    const scaleUpPolicy = new aws.autoscaling.Policy("scaleUpPolicy", {
        scalingAdjustment: 1,
        cooldown: 60,
        adjustmentType: "ChangeInCapacity",
        autoscalingGroupName: autoScalingGroup.name,
        policyType: 'SimpleScaling',
    });
 
    const scaleDownPolicy = new aws.autoscaling.Policy("scaleDownPolicy", {
        scalingAdjustment: -1,
        cooldown: 60,
        adjustmentType: "ChangeInCapacity",
        autoscalingGroupName: autoScalingGroup.name,
        policyType: 'SimpleScaling',
    });

    // CloudWatch Alarm for CPU Usage
    // const cpuAlarm = new aws.cloudwatch.MetricAlarm("cpuAlarm", {
    //     comparisonOperator: "GreaterThanOrEqualToThreshold",
    //     evaluationPeriods: 2,
    //     metricName: "CPUUtilization",
    //     namespace: "AWS/EC2",
    //     period: 60,
    //     statistic: "Average",
    //     threshold: 5,
    //     dimensions: {
    //         AutoScalingGroupName: autoScalingGroup.name,
    //     },
    //     alarmActions: [scaleUpPolicy.arn],
    //     okActions: [scaleDownPolicy.arn],
    //     insufficientDataActions: [],
    // });

    // Define CPU utilization alarms for the autoscaling policies
const highCpuAlarm = new aws.cloudwatch.MetricAlarm("HighCpuAlarm", {
    alarmDescription: "Scaling Up Alarm",
    comparisonOperator: "GreaterThanOrEqualToThreshold",
    evaluationPeriods: 2,
    metricName: "CPUUtilization",
    namespace: "AWS/EC2",
    period: 60,
    statistic: "Average",
    threshold: 5,
    // actionsEnabled: true,
    alarmActions: [scaleUpPolicy.arn],
    dimensions: {
        AutoScalingGroupName: autoScalingGroup.name,
    },
    // okActions: [scaleDownPolicy.arn],
    insufficientDataActions: [],
});

const lowCpuAlarm = new aws.cloudwatch.MetricAlarm("LowCpuAlarm", {
    alarmDescription: "Scaling Down Alarm",
    comparisonOperator: "LessThanOrEqualToThreshold",
    evaluationPeriods: 1,
    metricName: "CPUUtilization",
    namespace: "AWS/EC2",
    period: 60,
    statistic: "Average",
    threshold: 3,
    // actionsEnabled: true,
    alarmActions: [scaleDownPolicy.arn],
    dimensions: {
        AutoScalingGroupName: autoScalingGroup.name,
    },
    // okActions: [scaleDownPolicy.arn],
    insufficientDataActions: [],
});


    // Create an Application Load Balancer (ALB)
    const loadBalancer = new aws.lb.LoadBalancer("loadBalancer", {
        securityGroups: [loadBalancerSecurityGroup.id],
        subnets: db_publicSubnets.map(subnet => subnet.id),
        enableDeletionProtection: false, // Set to true if you want to enable deletion protection
        });
     
        // Create a listener for the ALB
        const webAppListener = new aws.lb.Listener("webAppListener", {
            loadBalancerArn: loadBalancer.arn,
            port: 80,
            defaultActions: [{
                type: "forward",
                targetGroupArn: appTargetGroup.arn
            }],
        });

    // Function to create Route53 DNS A record
    const createDnsARecord = async (domainName, loadBalancer) => {
        const hostedZone = await aws.route53.getZone({
            name: domainName,
        });
    
        if (hostedZone) {
            const recordName = domainName;
            const recordType = "A";
            // const recordTtl = 60;
            const recordSet = new aws.route53.Record(`dnsARecord-${recordName}`, {
                name: recordName,
                type: recordType,
                zoneId: hostedZone.zoneId,
                aliases: [
                    {
                        evaluateTargetHealth: true,
                        name: loadBalancer.dnsName,
                        zoneId: loadBalancer.zoneId,
                    },
                ],
                //records: [ec2Instance.publicIp],
                //ttl: recordTtl,
                allowOverwrite: true,
            });
        }
        else
        {
            console.error(`Zone for domain '${domainName}' not found.`);
        }
    };
 

// Call the function to create DNS A record
createDnsARecord(domainName, loadBalancer);
};


//function to create subnets
createSubnets();
