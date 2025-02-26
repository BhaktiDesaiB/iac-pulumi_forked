const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const awsx = require("@pulumi/awsx");

const vpcCIDRBlock = new pulumi.Config("my_vpc").require("cidrBlock");
const publicRouteTableCIDRBlock = new pulumi.Config("my_publicRouteTable").require("cidrBlock");
const Ami_ID = new pulumi.Config("AMIID").require("AMIID");
const DomainName = new pulumi.Config("DomainName").require("DomainName");
const KeyPair = new pulumi.Config("KeyPair").require("KeyPair");
const gcp = require("@pulumi/gcp");
const project = new pulumi.Config("gcp").require("project");
const gcpregion = new pulumi.Config("gcp").require("region");
const region = new pulumi.Config("aws").require("region");
const GithubPAT = new pulumi.Config("github").require("pat");
const MailgunAPI = new pulumi.Config("mailgun").require("API");
const gcpBucketName = new pulumi.Config("gcp").require("bucketname");

require('dotenv').config();

// VPC
const main = new aws.ec2.Vpc("Pulumi_01", {
    cidrBlock: vpcCIDRBlock,
    instanceTenancy: "default",
    tags: {
        Name: "Pulumi_01",
    },
});

const publicSubnets = [];
const privateSubnets = [];

// availability zones
const getAvailableAvailabilityZones = async () => {
    const zones = await aws.getAvailabilityZones({ state: "available" });
    const i = Math.min(zones.names.length, 3);
    console.log('zones now: ', i);
    return zones.names.slice(0, i);
};

const createSubnets = async () => {
    const availabilityZones = await getAvailableAvailabilityZones();
    for (let i = 0; i < availabilityZones.length; i++) {

        //public subnet
        const publicSubnet = new aws.ec2.Subnet(`subnet_public_name${i + 1}`, {
            vpcId: main.id,
            availabilityZone: availabilityZones[i],
            cidrBlock: `10.0.${i + 1}.0/24`,
            mapPublicIpOnLaunch: true,
            tags: {
                Name: `subnet_public_name${i + 1}`,
            },
        });
        publicSubnets.push(publicSubnet);

        //private subnet
        const privateSubnet = new aws.ec2.Subnet(`subnet_private_name${i + 1}`, {
            vpcId: main.id,
            availabilityZone: availabilityZones[i],
            cidrBlock: `10.0.${availabilityZones.length + i + 1}.0/24`,
            tags: {
                Name: `subnet_private_name${i + 1}`,
            },
        });
        privateSubnets.push(privateSubnet);
    }

//route tables
const publicRouteTable = new aws.ec2.RouteTable("public_route_table", {
    vpcId: main.id,
    tags: {
        Name: "public_route_table",
    },
});

const privateRouteTable = new aws.ec2.RouteTable("private_route_table", {
    vpcId: main.id,
    tags: {
        Name: "private_route_table",
    },
});

const publicRouteTableAssociations = [];
const privateRouteTableAssociations = [];

// public subnets associates with the public route table
for (let i = 0; i < availabilityZones.length; i++) {
    let x = i+1;
    const association = new aws.ec2.RouteTableAssociation("public_subnetconnect"+x, {
        subnetId: publicSubnets[i].id,
        routeTableId: publicRouteTable.id,
    });
    publicRouteTableAssociations.push(association);
}

// private subnets Associates with the private route table
for (let i = 0; i < availabilityZones.length; i++) {
    let x = i+1;
    const association = new aws.ec2.RouteTableAssociation("private_subnetconnect"+x, {
        subnetId: privateSubnets[i].id,
        routeTableId: privateRouteTable.id,
    });
    privateRouteTableAssociations.push(association);
}

//Internet Gateway
const internetGateway = new aws.ec2.InternetGateway("internet_gateway", {
    vpcId: main.id,
    tags: {
        Name: "internet_gateway",
    },
});

//public route - public route table
const publicRoute = new aws.ec2.Route("public_route", {
    routeTableId: publicRouteTable.id,
    destinationCidrBlock: publicRouteTableCIDRBlock,
    gatewayId: internetGateway.id,
});

//loadbalancer security group
const LoadBalancerSecurityGroup = new aws.ec2.SecurityGroup("LoadBalancerSecurityGroup", {
    vpcId: main.id,
    ingress: [
        // {
        //     fromPort: 80,
        //     toPort: 80,
        //     protocol: "tcp",
        //     cidrBlocks: ["0.0.0.0/0"],
        // },
        {
            fromPort: 443,
            toPort: 443,
            protocol: "tcp",
            cidrBlocks: ["0.0.0.0/0"],
        },
    ],
    egress: [
        {
            fromPort: 0,
            toPort: 0,
            protocol: "-1",
            cidrBlocks: ["0.0.0.0/0"],
        },
    ],
    tags: {
        Name: "LoadBalancerSecurityGroup",
    },
});

//application security group
const appSecurityGroup = new aws.ec2.SecurityGroup("appSecurityGroup", {
    vpcId: main.id,
    ingress: [
        // {
        //     fromPort: 22,
        //     toPort: 22,
        //     protocol: "tcp",
        //     cidrBlocks: ["0.0.0.0/0"],
        // },
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
        // Add ingress rule for your application port here
        {
            fromPort: 3000,
            toPort: 3000,
            protocol: "tcp",
            securityGroups: [LoadBalancerSecurityGroup.id],
        },
    ],
    egress: [
        {
            fromPort: 0,
            toPort: 0,
            protocol: "-1",
            cidrBlocks: ["0.0.0.0/0"],
        }
    ],
    tags: {
        Name: "appSecurityGroup",
    },
});


const dbSecurityGroup = new aws.ec2.SecurityGroup("dbSecurityGroup", {
    vpcId: main.id,
    ingress: [
        {
            fromPort: 3306,
            toPort: 3306,
            protocol: "tcp",
            securityGroups: [appSecurityGroup.id], // Allow SSH from anywhere
        },
    ],
    egress: [
        {
            fromPort: 3306,
            toPort: 3306,
            protocol: "tcp",
            securityGroups: [appSecurityGroup.id],
        }
    ],
    tags: {
        Name: "dbSecurityGroup",
    },
});

//subnet group
const dbSubnetGroup = new aws.rds.SubnetGroup("mydbsubnetgroup", {
    subnetIds: [privateSubnets[0].id, privateSubnets[1].id], // Replace with your subnet IDs
    dbSubnetGroupDescription: "My DB Subnet Group",
    tags: {
        Name: "mydbsubnetgroup",
    },
});

//RDS parameter group
const rdsParameterGroup = new aws.rds.ParameterGroup("myRdsParameterGroup", {
    vpcId: main.id,
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

//rds instance
const rdsInstance = new aws.rds.Instance("myrdsinstance", {
    dbName: "csye6225",
    identifier: "csye6225",
    allocatedStorage: 20,             // The storage capacity for the RDS instance
    storageType: "gp2",               // General Purpose (SSD)
    engine: "mariadb",                 // The database engine (e.g., MySQL, PostgreSQL, etc.)
    //engineVersion: "5.7",            // Engine version
    instanceClass: "db.t2.micro",    // RDS instance type
    username: "root",
    password: "root#123",           
    skipFinalSnapshot: true,         // Do not create a final DB snapshot when the instance is deleted
    publiclyAccessible: false,       // RDS instance is not publicly accessible
    multiAz: false,                  // Multi-AZ deployment (true for high availability)
    vpcSecurityGroupIds: [dbSecurityGroup.id], // Add security group IDs to control access
    dbSubnetGroupName: dbSubnetGroup.id, // Name of the DB subnet group (create one if it doesn't exist)
    parameterGroupName: rdsParameterGroup.name,
    protect: true,
});

//rds host
const rdsHost = rdsInstance.endpoint.apply(endpoint => {
    return endpoint.split(":")[0];
});

//rds instance address
const dbHostname = pulumi.interpolate`${rdsInstance.address}`;
 
    //gcp service account
    let serviceAccount = new gcp.serviceaccount.Account("myServiceAccount", {
        accountId: "myserviceaccount123",
        displayName: "My Service Account",
    });
 
    //access keys
    let accessKeys = new gcp.serviceaccount.Key("myAccessKeys", {
        serviceAccountId: serviceAccount.name,
    });
 
    //storage permissions
    let storageObjectCreatorRole = new gcp.projects.IAMMember("storageObjectCreator", {
        project: project,
        role: "roles/storage.admin",
        member: pulumi.interpolate`serviceAccount:${serviceAccount.email}`,
    });
 
    //SNS topic
    const mySNSTopic = new aws.sns.Topic("mySNSTopic", {
        displayName: "My SNS Topic",
        tags: {
            Name: "mySNSTopic",
        },
    });
    pulumi.log.info(
        pulumi.interpolate`SNS Topic ARN: ${mySNSTopic.arn}`
    );
    const snsArn = mySNSTopic.arn;

    //DynamoDB table
    const emailTable = new aws.dynamodb.Table("EmailTable", {
        attributes: [
            { name: "Toemail", type: "S" },
            { name: "Timestamp", type: "S" },
            { name: "EmailParams", type: "S" }, 
            { name: "Status", type: "S" }, 
        ],
        hashKey: "Toemail",
        rangeKey: "Timestamp",
        billingMode: "PAY_PER_REQUEST",
        globalSecondaryIndexes: [
            {
                name: "StatusIndex",
                hashKey: "Status",
                projectionType: "ALL",
            },
            {
                name: "EmailParamsIndex",
                hashKey: "EmailParams",
                projectionType: "ALL",
            },
        ],
    });
    
    //lambda role
    let lambdaRole = new aws.iam.Role("lambdaRole", {
        assumeRolePolicy: JSON.stringify({
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Action": "sts:AssumeRole",
                    "Principal": { "Service": "lambda.amazonaws.com" },
                    "Effect": "Allow",
                }
            ],
        }),
    });

    //full access - dynaamo to lambda
    let fullAccessToDynamoDb = new aws.iam.RolePolicyAttachment("fullAccessToDynamoDb", {
        role: lambdaRole.name,
        policyArn: "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess", // Delegate full access to the dynamoDB service
    });
 
    // cloudwatch to lambda
    const cloudwatchPolicy = new aws.iam.RolePolicyAttachment("logPolicy", {
        role: lambdaRole.name,
        policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
    });
 
    //lambda function
    const lambdaFunction = new aws.lambda.Function("lambdaFunction", {
        code: new pulumi.asset.FileArchive("C:/Users/bhakt/Downloads/serverless-main.zip"),
        role: lambdaRole.arn,
        handler: "serverless/index.handler",
        runtime: "nodejs18.x",
        timeout: 30,
        environment: {
            variables: {
                "GCP_SERVICE_ACCOUNT_KEY": accessKeys.privateKey,
                "GCP_PROJECT_ID": project,
                "DYNAMODB_TABLE": emailTable.name,
                "GITHUB_ACCESS_TOKEN": GithubPAT,
                "MAILGUN_API_KEY": MailgunAPI,
                "GCP_BUCKET_NAME": gcpBucketName,
            },
        },
    });
 
    //lambda permission
    const lambdaPermission = new aws.lambda.Permission("snsTopicPermission", {
        action: "lambda:InvokeFunction",
        "function": lambdaFunction.name,
        principal: "sns.amazonaws.com",
        sourceArn: mySNSTopic.arn
    });
 
    // SNS topic subscription
    let topicSubscription = new aws.sns.TopicSubscription("mySubscription", {
        topic: snsArn,
        endpoint: lambdaFunction.arn,
        protocol: "lambda",
    },
    { dependsOn: mySNSTopic }
    );

//cloudwatch agent role
const cloudWatchAgentRole = new aws.iam.Role("cloudWatchAgentRole", {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Principal: {
            Service: "ec2.amazonaws.com"
          },
          Effect: "Allow",
        },
      ],
    }),
  });

//cloudWatchAgent Role - server PolicyAttachment
const cloudWatchAgentRolePolicyAttachment = new aws.iam.RolePolicyAttachment(
    "cloudWatchAgentRolePolicyAttachment",
    {
      policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
      role: cloudWatchAgentRole.name,
    }
  );

//cloudWatchAgent Role - sns PolicyAttachment
const SNSPolicyAttachment = new aws.iam.RolePolicyAttachment(
    "SNSRolePolicyAttachment",
    {
      policyArn: "arn:aws:iam::aws:policy/AmazonSNSFullAccess",
      role: cloudWatchAgentRole.name,
    }
  );

//cloudWatchAgent role profile
const RoleProfile = new aws.iam.InstanceProfile("RoleProfile", {role: cloudWatchAgentRole.name});

    // EC2 Instance
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

//webapp loadbalancer
const LoadBalancer = new aws.lb.LoadBalancer("WebAPPLoadBalancer", {
    internal: false,
    loadBalancerType: "application",
    securityGroups: [LoadBalancerSecurityGroup.id],
    subnets: publicSubnets.map(subnet => (subnet.id)),
});
  

//Route53 DNS - A record
const createDnsARecord = async (domainName) => {
    const hostedZone = await aws.route53.getZone({
        name: domainName,
    });
 
    if (hostedZone) {
        const recordName = domainName;
        const recordType = "A";
        const recordTtl = 60;
        const recordSet = new aws.route53.Record(`dnsARecord-${recordName}`, {
            name: recordName,
            type: recordType,
            zoneId: hostedZone.zoneId,
            aliases:[{
                name:LoadBalancer.dnsName,
                zoneId:LoadBalancer.zoneId,
                evaluateTargetHealth: true,
            }],
            // records: [ec2Instance.publicIp],
            // ttl: recordTtl,
            // allowOverwrite: true,
        });
    }
    else
    {
        console.error(`Zone for domain '${domainName}' not found.`);
    }
};
createDnsARecord(DomainName);


//user data script
const UserdataScript = pulumi.interpolate `#!/bin/bash
# Create the .env file inside the /opt/example folder
sudo sh -c 'echo "PORT=3000" >> /opt/csye6225/webapp/.env'
sudo sh -c 'echo "DB_HOST=${rdsHost}" >> /opt/csye6225/webapp/.env'
sudo sh -c 'echo "DB_PORT=3306" >> /opt/csye6225/webapp/.env'
sudo sh -c 'echo "DB_DATABASE=${rdsInstance.dbName}" >> /opt/csye6225/webapp/.env'
sudo sh -c 'echo "DB_USER=${rdsInstance.username}" >> /opt/csye6225/webapp/.env'
sudo sh -c 'echo "DB_PASSWORD=${rdsInstance.password}" >> /opt/csye6225/webapp/.env'
sudo sh -c 'echo "SNSTOPICARN=${snsArn}" >> /opt/csye6225/webapp/.env'
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
-a fetch-config \
-m ec2 \
-c file:/opt/aws/amazon-cloudwatch-agent/bin/cloudwatch-config.json \
-s
`;
pulumi.log.info(
    pulumi.interpolate`DB data: dbHostname, userDataScript - ${rdsHost}, ${UserdataScript}`
);

//encoeding user data script
const encodedUserData = UserdataScript.apply(ud => Buffer.from(ud).toString('base64'));

//launch template
const asg_launch_config = new aws.ec2.LaunchTemplate("asg_launch_config", {
    name: "myLaunchTemplate",
    version: "$Latest",
    imageId: Ami_ID,
    instanceType: "t2.micro",
    keyName: KeyPair,
    vpcSecurityGroupIds: [appSecurityGroup.id],
    iamInstanceProfile: {
        name: RoleProfile,
    },
    disableApiTermination: false,
    ebsOptimized: false,
    rootBlockDevice:
        {
            deleteOnTermination: true,
            volumeSize: 20,
            volumeType: "gp2",
        },
    userData: encodedUserData,
    associatePublicIpAddress: true,
    
});

//Target Group - Load Balancer
const targetGroup = new aws.lb.TargetGroup("applicationTargetGroup", {
    namePrefix: "tg-grp",
    port: 3000,
    protocol: "HTTP",
    targetType: "instance",
    vpcId: main.id,
    healthCheck: {
        path: "/healthz",
        port: "traffic-port",
        protocol: "HTTP",
        interval: 30,
        healthyThreshold: 2,
        unhealthyThreshold: 2,
        timeout: 5,
    },
});

//webapp auto scaler
const webapp_autoscaling_group = new aws.autoscaling.Group("webapp_autoscaling_group", {
    name: "webapp_autoscaling_group",
    desiredCapacity: 1,
    maxSize: 3,
    minSize: 1,
    launchTemplate: {
        id: asg_launch_config.id,
        version: "$Latest",
    },
    defaultCooldown: 60,
    vpcZoneIdentifiers: [publicSubnets[0].id],
    targetGroupArns: [targetGroup.arn],
    tags:[
        {
        key: "Name",
        value: "WEBAPP Instance",
        propagateAtLaunch: true,
        },
    ]
});

//Scale Up -  Autoscaling Policy
const asg_scaleUpPolicy = new aws.autoscaling.Policy("asg_scaleUpPolicy", {
    scalingAdjustment: 1,
    autoscalingGroupName: webapp_autoscaling_group.name,
    adjustmentType: "ChangeInCapacity",
    cooldown: 60,
});

// Scale Down - Autoscaling Policy
const asg_scaleDownPolicy = new aws.autoscaling.Policy("asg_scaleDownPolicy", {
    scalingAdjustment: -1,
    autoscalingGroupName: webapp_autoscaling_group.name,
    adjustmentType: "ChangeInCapacity",
    cooldown: 60,
});

//Scale Up alarm
const alarmScaleUp = new aws.cloudwatch.MetricAlarm("alarmScaleUp", {
    alarmDescription: "This metric monitors EC2 CPU utilization",
    namespace: "AWS/EC2",
    metricName: "CPUUtilization",
    statistic: "Average",
    threshold: 5,
    comparisonOperator: "GreaterThanOrEqualToThreshold",
    period: 120,
    evaluationPeriods: 2,
    dimensions: {
        AutoScalingGroupName: webapp_autoscaling_group.name,
    },
    actionsEnabled: true,
    alarmActions: [asg_scaleUpPolicy.arn],
});

//Scale Down alarm
const alarmScaleDown = new aws.cloudwatch.MetricAlarm("alarmScaleDown", {
    alarmDescription: "This metric monitors EC2 CPU utilization",
    namespace: "AWS/EC2",
    metricName: "CPUUtilization",
    statistic: "Average",
    threshold: 3,
    comparisonOperator: "LessThanOrEqualToThreshold",
    period: 120,
    evaluationPeriods: 2,
    dimensions: {
        AutoScalingGroupName: webapp_autoscaling_group.name,
    },
    actionsEnabled: true,
    alarmActions: [asg_scaleDownPolicy.arn],
});

//ssl certificate
const certificate = aws.acm.getCertificate({
    domain: DomainName,
    statuses: ["ISSUED"],
});

// load Balancer Listener
const listener = new aws.lb.Listener("applicationListener", {
    loadBalancerArn: LoadBalancer.arn,
    port: 443,
    protocol: "HTTPS",
    sslPolicy: "ELBSecurityPolicy-2016-08", // Specify the SSL policy
    certificateArn: certificate.arn, // Add your SSL certificate ARN here
    defaultActions: [{
        type: "forward",
        targetGroupArn: targetGroup.arn,
    }],
});
};

createSubnets();


