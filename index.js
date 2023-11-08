const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const vpcCIDRBlock = new pulumi.Config("db_vpc").require("cidrBlock");
const publicRouteTableCIDRBlock = new pulumi.Config("db_publicRouteTable").require("cidrBlock");
const region = new pulumi.Config("aws").require("region");
const db_keyName = new pulumi.Config("db_vpc").require("key");
const dbName = new pulumi.Config("dbName").require("name");
const dbPassword = new pulumi.Config("dbPassword").require("password");
const dbUserName = new pulumi.Config("dbUserName").require("user");
const db_ami = "ami-0ced45d96b68ffaaa";
const domainName = new pulumi.Config("dbDomainName").require("domainName");


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

    // EC2 Security Group for Web Applications
    const appSecurityGroup = new aws.ec2.SecurityGroup("appSecurityGroup", {
        vpcId: db_vpc.id,
        ingress: [
            {
                fromPort: 22,
                toPort: 22,
                protocol: "tcp",
                cidrBlocks: ["0.0.0.0/0"], // Allow SSH from anywhere
            },
            {
                fromPort: 80,
                toPort: 80,
                protocol: "tcp",
                cidrBlocks: ["0.0.0.0/0"], // Allow HTTP from anywhere
            },
            {
                fromPort: 443,
                toPort: 443,
                protocol: "tcp",
                cidrBlocks: ["0.0.0.0/0"], // Allow HTTPS from anywhere
            },
            {
                fromPort: 3000,
                toPort: 3000,
                protocol: "tcp",
                cidrBlocks: ["0.0.0.0/0"],
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
                cidrBlocks: ["0.0.0.0/0"]
            },
        ],
        egress: [
             // Add egress rule for your application port
             {
                fromPort: 3306,
                toPort: 3306,
                protocol: "tcp",
                securityGroups: [appSecurityGroup.id],
                cidrBlocks: ["0.0.0.0/0"]
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
                subnetIds: [db_privateSubnets[0].id, db_privateSubnets[1].id],
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
        username: dbUserName,
        password: dbPassword,
        skipFinalSnapshot: true, // To avoid taking a final snapshot when deleting the RDS instance
        publiclyAccessible: false, // Ensure it's not publicly accessible
        dbSubnetGroupName: rdsSubnetGroup.name,
        vpcSecurityGroupIds: [databaseSecurityGroup.id], //ec2Instance.id.vpcSecurityGroupIds --> this does not attach the databseSecurityGroup, 
        // Attach the security group
        // subnetIds: db_privateSubnets.map(subnet => subnet.id), // Use private subnets
        dbName: dbName, // Database name
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
    sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
-a fetch-config \
    -m ec2 \
    -c file:/opt/csye6225/bhaktidesai_002701264_05/amazon-cloudwatch-agent.json \
    -s
    sudo systemctl enable amazon-cloudwatch-agent
    sudo systemctl start amazon-cloudwatch-agent`;
    pulumi.log.info(
        pulumi.interpolate`DB data: DB_HOST, userDataScript - ${DB_HOST}, ${userData}`
    );

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

    // EC2 Instance
    const ec2Instance = new aws.ec2.Instance("ec2Instance", {
        instanceType: "t2.micro", // Set the desired instance type
        ami: db_ami, // Replace with your custom AMI ID
        vpcSecurityGroupIds: [appSecurityGroup.id],
        subnetId: db_publicSubnets[0].id, // Choose one of your public subnets
        vpcId: db_vpc.id,
        keyName: db_keyName,
        rootBlockDevice: {
            volumeSize: 25,
            volumeType: "gp2",
        },
        protectFromTermination: false,
        userData: userData, // Attach the user data script
        tags: {
            Name: "db_EC2Instance",
        },
        iamInstanceProfile: instanceProfile.name,
    });

// Function to create Route53 DNS A record
const createDnsARecord = async (domainName, ec2Instance) => {
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
            records: [ec2Instance.publicIp],
            ttl: recordTtl,
            allowOverwrite: true,
        });
    } 
    else 
    {
        console.error(`Zone for domain '${domainName}' not found.`);
    }
};

// Call the function to create DNS A record
createDnsARecord(domainName, ec2Instance);
};



//function to create subnets
createSubnets();
