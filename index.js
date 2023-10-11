// // "use strict";
// const pulumi = require("@pulumi/pulumi");
// const aws = require("@pulumi/aws");
// const awsx = require("@pulumi/awsx");

// //create vpc
// const db_vpc = new aws.ec2.Vpc("db_vpc", {
//     cidrBlock: "10.0.0.0/16",
//     instanceTenancy: "default",
//     tags: {
//         Name: "db_vpc",
//     },
// });

// // Create 3 public subnets
// const db_publicSubnets = [];
// for (let i = 1; i <= 3; i++) {
//     const subnet = new aws.ec2.Subnet(`db_publicSubnet${i}`, {
//         vpcId: db_vpc.id,
//         availabilityZone: `us-east-1a`, // Change the AZ as needed
//         cidrBlock: `10.0.1${i}.0/24`, // Adjust CIDR blocks as needed
//         tags: {
//             Name: `db_publicSubnet${i}`,
//         },
//     });
//     db_publicSubnets.push(subnet);
// }

// // Create 3 private subnets
// const db_privateSubnets = [];
// for (let i = 1; i <= 3; i++) {
//     const subnet = new aws.ec2.Subnet(`db_privateSubnet${i}`, {
//         vpcId: db_vpc.id,
//         availabilityZone: `us-east-1a`, // Change the AZ as needed
//         cidrBlock: `10.0.4${i}.0/24`, // Adjust CIDR blocks as needed
//         tags: {
//             Name: `db_privateSubnet${i}`,
//         },
//     });
//     db_privateSubnets.push(subnet);
// }

// // Create an Internet Gateway
// const db_internetGateway = new aws.ec2.InternetGateway("db_internetGateway",
// { 
//     tags: {
//     Name: "db_internetGateway",
//     },
// });

// // Attach the Internet Gateway to the VPC
// const db_attachment = new aws.ec2.InternetGatewayAttachment("db_attachment", 
// {
//     vpcId: db_vpc.id,
//     internetGatewayId: db_internetGateway.id,
//     tags: {
//         Name: "db_attachment",
//         },
// });

// const db_routeTablePublic = new aws.ec2.RouteTable("db_routeTablePublic", {
//     vpcId: db_vpc.id,
//     routes: [
//         {
//             cidrBlock: "10.0.1.0/24",
//             gatewayId: db_internetGateway.id,
//         },
//         {
//             ipv6CidrBlock: "::/0",
//             egressOnlyGatewayId: db_internetGateway.id,
//         },
//     ],
//     tags: {
//         Name: "db_routeTablePublic",
//     },
// });


// "use strict";
const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const awsx = require("@pulumi/awsx");

// // Create an AWS resource (S3 Bucket)
// const bucket = new aws.s3.Bucket("my-bucket");
// // Export the name of the bucket
// exports.bucketName = bucket.id;

//create vpc
const db_vpc = new aws.ec2.Vpc("db_vpc", {
    cidrBlock: "10.0.0.0/16",
    instanceTenancy: "default",
    tags: {
        Name: "db_vpc",
    },
});


// Create an Internet Gateway
const db_internetGateway = new aws.ec2.InternetGateway("db_internetGateway",
{ 
    tags: {
    Name: "db_internetGateway",
    },
});

// Attach the Internet Gateway to the VPC
const db_attachment = new aws.ec2.InternetGatewayAttachment("db_attachment", 
{
    vpcId: db_vpc.id,
    internetGatewayId: db_internetGateway.id,
    tags: {
        Name: "db_attachment",
        },
});


//public RouteTable
const db_publicRouteTable = new aws.ec2.RouteTable("db_publicRouteTable", {
    vpcId: db_vpc.id,
    // routeTableId: publicRouteTable.id
    routes: [
        {
            cidrBlock: "10.0.1.0/24",
            gatewayId: db_internetGateway.id,
        },
        {
            ipv6CidrBlock: "::/0",
            egressOnlyGatewayId: db_internetGateway.id,
        },
    ],
    tags: {
        Name: "db_publicRouteTable",
    },
});


// Create 3 public subnets
const db_publicSubnets = [];
for (let i = 1; i <= 3; i++) {
    const subnet = new aws.ec2.Subnet(`db_publicSubnet${i}`, {
        vpcId: db_vpc.id,
        availabilityZone: `us-east-1a`, // Change the AZ as needed
        cidrBlock: `10.0.1${i}.0/24`, // Adjust CIDR blocks as needed
        tags: {
            Name: `db_publicSubnet${i}`,
        },
    });

    db_publicSubnets.push(subnet);
}

// Attach all public subnets to the route table
for (let i = 0; i < db_publicSubnets.length; i++) {
    new aws.ec2.RouteTableAssociation(`db_publicRouteTableAssociation-${i}`, {
        subnetId: db_publicSubnets[i].id,
        routeTableId: db_publicRouteTable.id,
    });
}


//private RouteTable
const db_privateRouteTable = new aws.ec2.RouteTable("db_privateRouteTable", {
    vpcId: db_vpc.id,
    // routeTableId: publicRouteTable.id
    routes: [
        {
            cidrBlock: "10.0.1.0/24",
            gatewayId: db_internetGateway.id,
        },
        {
            ipv6CidrBlock: "::/0",
            egressOnlyGatewayId: db_internetGateway.id,
        },
    ],
    tags: {
        Name: "db_privateRouteTable",
    },
});


// Create 3 private subnets
const db_privateSubnets = [];
for (let i = 1; i <= 3; i++) {
    const subnet = new aws.ec2.Subnet(`db_privateSubnet${i}`, {
        vpcId: db_vpc.id,
        availabilityZone: `us-east-1a`, // Change the AZ as needed
        cidrBlock: `10.0.4${i}.0/24`, // Adjust CIDR blocks as needed
        tags: {
            Name: `db_privateSubnet${i}`,
        },
    });
    db_privateSubnets.push(subnet);
}

// Attach all private subnets to the route table
for (let i = 0; i < db_privateSubnets.length; i++) {
    new aws.ec2.RouteTableAssociation(`db_privateRouteTableAssociation-${i}`, {
        subnetId: db_privateSubnets[i].id,
        routeTableId: db_privateRouteTable.id,
    });
}