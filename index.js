const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const vpcCIDRBlock = new pulumi.Config("db_vpc").require("cidrBlock");
const publicRouteTableCIDRBlock = new pulumi.Config("db_publicRouteTable").require("cidrBlock");
const region = new pulumi.Config("aws").require("region");
const db_keyName = new pulumi.Config("db_vpc").require("key");


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
            // Add ingress rule for your application port here
            {
                fromPort: 3000,
                toPort: 3000,
                protocol: "tcp",
                cidrBlocks: ["0.0.0.0/0"],
            }
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

    // EC2 Instance
    const ec2Instance = new aws.ec2.Instance("ec2Instance", {
        instanceType: "t2.micro", // Set the desired instance type
        ami: "ami-09f39ff72f7f59a3a", // Replace with your custom AMI ID
        vpcSecurityGroupIds: [appSecurityGroup.id],
        subnetId: db_publicSubnets[0].id, // Choose one of your public subnets
        vpcId: db_vpc.id,
        keyName: db_keyName,
        rootBlockDevice: {
            volumeSize: 25,
            volumeType: "gp2",
        },
        tags: {
            Name: "db_EC2Instance",
        },
    });
};
createSubnets(); //function to create subnets