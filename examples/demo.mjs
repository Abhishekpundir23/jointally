export const leftCSV = `order_id,customer_id,region,revenue
1001,northstar,US,1200.00
1002,juniper,EU,800.00
1003,orbit,US,1600.00
1004,northstar,EU,1850.00
1005,cedar,APAC,975.25
1006,marlin,US,1175.00
1007,juniper,US,650.00
1008,northstar,APAC,950.00
1009,cedar,APAC,615.75
1010,lumen,EU,500.00
`;

export const rightCSV = `customer_id,region,segment
northstar,US,Enterprise
northstar,EU,Enterprise
northstar,APAC,Growth
juniper,US,Growth
juniper,EU,Enterprise
orbit,US,Enterprise
cedar,APAC,Startup
marlin,US,Growth
`;

export const balancedLeftCSV = `order_id,customer_id,region,revenue
201,a,US,100.00
202,b,EU,100.00
203,c,US,50.00
`;

export const balancedRightCSV = `customer_id,region,segment
a,US,Retail
a,CA,Enterprise
c,US,Retail
`;
