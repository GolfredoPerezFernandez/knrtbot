import { ethers } from 'ethers';
import FACTORY_ABI from '~/abis/factory.json';
import QUOTER_ABI from '~/abis/quoter.json';
import SWAP_ROUTER_ABI from '~/abis/swaprouter.json';
import POOL_ABI from '~/abis/pool.json';
import TOKEN_IN_ABI from '~/abis/weth.json';
import 'dotenv/config';
import fs from 'fs';
import { eventStream } from "remix-utils/sse/server";
import { LoaderFunctionArgs } from '@remix-run/node';

// Direcciones de despliegue
const POOL_FACTORY_CONTRACT_ADDRESS = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const QUOTER_CONTRACT_ADDRESS = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';
const SWAP_ROUTER_CONTRACT_ADDRESS = '0x2626664c2603336E57B271c5C0b26F421741e481';

// Instancias de Provider y Contracts
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const factoryContract = new ethers.Contract(POOL_FACTORY_CONTRACT_ADDRESS, FACTORY_ABI, provider);
const quoterContract = new ethers.Contract(QUOTER_CONTRACT_ADDRESS, QUOTER_ABI, provider);

// Cargar las claves privadas de PRIVATE_KEY1 a PRIVATE_KEY10
const privateKeys: string[] = [];
for (let i = 1; i <= 10; i++) {
    const key = process.env[`PRIVATE_KEY${i}`];
    if (key) {
        privateKeys.push(key);
    }
}

const WETH = {
    chainId: 8453,
    address: '0x54de10FADF4Ea2fbAD10Ebfc96979D0885dd36fA',
    decimals: 18,
    symbol: 'KNRT',
    name: 'Koolinart',
    isToken: true,
};

const USDC = {
    chainId: 8453,
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: 6,
    symbol: 'USDC',
    name: 'USDC',
    isToken: true,
    isNative: true,
    wrapped: false
};

// Array para almacenar mensajes de registro
let logMessages: string[] = [];

// Función para obtener la fecha actual en formato YYYY-MM-DD
function getCurrentDate() {
    const now = new Date();
    return now.toISOString().split('T')[0];
}

// Función para registrar detalles de transacciones
function logTransactionDetails(message: string) {
    const logMessage = `[${new Date().toISOString()}] ${message}\n`;
    logMessages.push(logMessage);
}

// Función para escribir el registro en un archivo
function writeLogToFile() {
    const logData = logMessages.join('');
    const logFileName = `${getCurrentDate()}_transaction_summary.txt`;
    fs.writeFileSync(logFileName, logData, 'utf8');
    logMessages = [];
}

// Función para programar el guardado diario de registros
function scheduleDailyLog() {
    setInterval(() => {
        writeLogToFile();
    }, 24 * 60 * 60 * 1000);
}

// Función auxiliar para obtener el balance
async function getBalance(tokenAddress: string, walletAddress: string) {
    const tokenContract = new ethers.Contract(tokenAddress, TOKEN_IN_ABI, provider);
    const balance = await tokenContract.balanceOf(walletAddress);
    return balance; // Esto es un BigInt en ethers v6
}

// Función auxiliar para aprobar tokens
async function approveToken(tokenAddress: string, tokenABI: any, amount: bigint, wallet: ethers.Wallet, send: any) {
    try {
        const tokenContract = new ethers.Contract(tokenAddress, tokenABI, wallet);

        const transactionResponse = await tokenContract.approve(
            SWAP_ROUTER_CONTRACT_ADDRESS,
            amount
        );

        send({
            event: "transaction",
            data: JSON.stringify({
                type: "approval",
                hash: transactionResponse.hash,
                from: wallet.address,
                token: tokenAddress,
                amount: amount.toString(),
                timestamp: Date.now(),
            }),
        });

        logTransactionDetails(`Transacción de aprobación enviada: ${transactionResponse.hash}`);

        const receipt = await transactionResponse.wait();
        const gasUsed = receipt.gasUsed.toString();
        const gasPrice = receipt.effectiveGasPrice.toString();

        const totalGasSpentInWei = BigInt(gasPrice) * BigInt(gasUsed);
        const totalGasSpentInEth = ethers.formatUnits(totalGasSpentInWei, 'ether');

        logTransactionDetails(`Gas total gastado en aprobación: ${totalGasSpentInWei.toString()} WEI`);
        logTransactionDetails(`Gas total gastado en aprobación: ${totalGasSpentInEth} ETH`);

        send({
            event: "log",
            data: `Transacción de aprobación confirmada: https://etherscan.io/tx/${receipt.transactionHash}`
        });
        logTransactionDetails(`Transacción de aprobación confirmada: https://etherscan.io/tx/${receipt.transactionHash} | Gas utilizado: ${gasUsed} | Precio del gas: ${gasPrice}`);

    } catch (error: any) {
        console.error("Ocurrió un error durante la aprobación del token:", error);
        send({ event: "error", data: JSON.stringify({ message: error.message, timestamp: Date.now() }) });
        throw new Error("Token approval failed");
    }
}

// Funciones adicionales necesarias
async function getPoolInfo(factoryContract: any, tokenA: any, tokenB: any) {
    const fee = 3000; // Ajustar según sea necesario
    const poolAddress = await factoryContract.getPool(tokenA.address, tokenB.address, fee);
    if (poolAddress === ethers.ZeroAddress) {
        throw new Error("El pool no existe");
    }
    const poolContract = new ethers.Contract(poolAddress, POOL_ABI, provider);
    const token0 = await poolContract.token0();
    const token1 = await poolContract.token1();
    return { poolContract, token0, token1, fee };
}

async function quoteAndLogSwap(quoterContract: any, fee: number, amountIn: bigint, tokenIn: any, tokenOut: any, outputDecimals: number, send: any) {
    const quotedAmountOut = await quoterContract.quoteExactInputSingle(
        tokenIn.address,
        tokenOut.address,
        fee,
        amountIn,
        0
    );
    const formattedAmountOut = ethers.formatUnits(quotedAmountOut, outputDecimals);
    send({
        event: "quote",
        data: JSON.stringify({
            tokenIn: tokenIn.symbol,
            tokenOut: tokenOut.symbol,
            amountIn: Number(ethers.formatUnits(amountIn, tokenIn.decimals)),
            estimatedAmountOut: Number(formattedAmountOut),
            timestamp: Date.now(),
        }),
    });
    return formattedAmountOut; // Retornamos como string
}

async function prepareSwapParams(wallet: ethers.Wallet, amountIn: bigint, amountOut: bigint, tokenIn: any, tokenOut: any) {
    const deadline = Math.floor(Date.now() / 1000) + (60 * 10); // 10 minutos desde ahora
    const amountOutMinimum = amountOut * BigInt(98) / BigInt(100); // Aceptar un deslizamiento del 2%
    const params = {
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        fee: 3000,
        recipient: wallet.address,
        deadline: deadline,
        amountIn: amountIn,
        amountOutMinimum: amountOutMinimum,
        sqrtPriceLimitX96: 0,
    };
    return params;
}

async function executeSwap(swapRouter: any, params: any, signer: ethers.Wallet, tokenIn: any, tokenOut: any, amountIn: bigint, amountOut: bigint, send: any) {
    try {
        const transactionResponse = await swapRouter.exactInputSingle(params);

        send({
            event: "transaction",
            data: JSON.stringify({
                type: "swap",
                hash: transactionResponse.hash,
                from: signer.address,
                amountIn: Number(ethers.formatUnits(amountIn, tokenIn.decimals)),
                amountOut: Number(ethers.formatUnits(amountOut, tokenOut.decimals)),
                tokenIn: tokenIn.symbol,
                tokenOut: tokenOut.symbol,
                timestamp: Date.now(),
            }),
        });

        const receipt = await transactionResponse.wait();
        send({ event: "log", data: `Transacción de intercambio confirmada: ${receipt.transactionHash}` });
    } catch (error: any) {
        console.error("Ocurrió un error durante la ejecución del intercambio:", error);
        send({ event: "error", data: JSON.stringify({ message: error.message, timestamp: Date.now() }) });
        throw new Error("Swap execution failed");
    }
}

// Función para generar un monto aleatorio basado en el balance
function getRandomAmount(balance: bigint, minPercentage: bigint, maxPercentage: bigint): bigint {
    const minPercentageBn = minPercentage;
    const maxPercentageBn = maxPercentage;

    const percentageRange = maxPercentageBn - minPercentageBn + 1n;

    const randomIntInRange = BigInt(Math.floor(Math.random() * Number(percentageRange)));

    const randomPercentage = minPercentageBn + randomIntInRange;

    const amount = balance * randomPercentage / 100n;

    return amount;
}

// Bucle del bot para verificar balances, aprobar tokens y realizar swaps
async function main(send: any) {
    scheduleDailyLog(); // Inicia el proceso de guardado diario de registros

    send({ event: "log", data: "Iniciando el bot de Uniswap..." });

    while (true) {
        try {
            // Seleccionar aleatoriamente una clave privada
            const randomIndex = Math.floor(Math.random() * privateKeys.length);
            const privateKey = privateKeys[randomIndex];
            const signer = new ethers.Wallet(privateKey, provider);

            send({ event: "log", data: `Usando la cuenta: ${signer.address}` });

            // Verificar balances
            const wethBalance = await getBalance(WETH.address, signer.address);
            const usdcBalance = await getBalance(USDC.address, signer.address);

            send({
                event: "balance",
                data: JSON.stringify({
                    account: signer.address,
                    wethBalance: Number(ethers.formatUnits(wethBalance, 18)),
                    usdcBalance: Number(ethers.formatUnits(usdcBalance, 6)),
                    timestamp: Date.now(),
                }),
            });

            // Definir porcentajes mínimos y máximos
            const minPercentage = 10n; // 10%
            const maxPercentage = 50n; // 50%

            // Mínimo monto de intercambio
            const minSwapAmountWETH = ethers.parseUnits("0.01", 18); // 0.01 WETH
            const minSwapAmountUSDC = ethers.parseUnits("10", 6);    // 10 USDC

            if (wethBalance >= minSwapAmountWETH) {
                // Generar monto aleatorio para WETH
                const wethToUsdcAmount = getRandomAmount(wethBalance, minPercentage, maxPercentage);

                if (wethToUsdcAmount >= minSwapAmountWETH) {
                    await approveToken(WETH.address, TOKEN_IN_ABI, wethToUsdcAmount, signer, send);
                    const { poolContract, token0, token1, fee } = await getPoolInfo(factoryContract, WETH, USDC);

                    send({ event: "log", data: `Obteniendo cotización para: ${WETH.symbol} a ${USDC.symbol}` });
                    send({ event: "log", data: `Cantidad de intercambio: ${ethers.formatUnits(wethToUsdcAmount, 18)} WETH` });

                    const quotedAmountOutStr = await quoteAndLogSwap(quoterContract, fee, wethToUsdcAmount, WETH, USDC, USDC.decimals, send);
                    const amountOutBN = ethers.parseUnits(quotedAmountOutStr, USDC.decimals);

                    const params = await prepareSwapParams(signer, wethToUsdcAmount, amountOutBN, WETH, USDC);
                    const swapRouter = new ethers.Contract(SWAP_ROUTER_CONTRACT_ADDRESS, SWAP_ROUTER_ABI, signer);
                    await executeSwap(swapRouter, params, signer, WETH, USDC, wethToUsdcAmount, amountOutBN, send);
                } else {
                    send({ event: "log", data: "El monto de WETH a intercambiar es menor que el mínimo permitido." });
                }
            } else if (usdcBalance >= minSwapAmountUSDC) {
                // Generar monto aleatorio para USDC
                const usdcToWethAmount = getRandomAmount(usdcBalance, minPercentage, maxPercentage);

                if (usdcToWethAmount >= minSwapAmountUSDC) {
                    await approveToken(USDC.address, TOKEN_IN_ABI, usdcToWethAmount, signer, send);
                    const { poolContract, token0, token1, fee } = await getPoolInfo(factoryContract, USDC, WETH);

                    send({ event: "log", data: `Obteniendo cotización para: ${USDC.symbol} a ${WETH.symbol}` });
                    send({ event: "log", data: `Cantidad de intercambio: ${ethers.formatUnits(usdcToWethAmount, 6)} USDC` });

                    const quotedAmountOutStr = await quoteAndLogSwap(quoterContract, fee, usdcToWethAmount, USDC, WETH, WETH.decimals, send);
                    const amountOutBN = ethers.parseUnits(quotedAmountOutStr, WETH.decimals);

                    const params = await prepareSwapParams(signer, usdcToWethAmount, amountOutBN, USDC, WETH);
                    const swapRouter = new ethers.Contract(SWAP_ROUTER_CONTRACT_ADDRESS, SWAP_ROUTER_ABI, signer);
                    await executeSwap(swapRouter, params, signer, USDC, WETH, usdcToWethAmount, amountOutBN, send);
                } else {
                    send({ event: "log", data: "El monto de USDC a intercambiar es menor que el mínimo permitido." });
                }
            } else {
                send({ event: "log", data: "No hay suficiente balance para realizar swaps." });
            }

        } catch (error: any) {
            console.error("Ocurrió un error:", error.message);
            send({ event: "error", data: JSON.stringify({ message: error.message, timestamp: Date.now() }) });
        }

        // Tiempo de espera aleatorio entre 1 y 10 segundos
        const sleepTime = Math.floor(Math.random() * 10) + 1; // Número entre 1 y 10
        send({ event: "log", data: `Esperando ${sleepTime} segundos antes de la siguiente iteración.` });
        await new Promise(resolve => setTimeout(resolve, sleepTime * 1000));
    }
}

// Loader de Remix para transmitir la salida del bot en tiempo real
export async function loader({ request }: LoaderFunctionArgs) {
    return eventStream(request.signal, function setup(send) {
        main(send);

        return function clear() {
            // Limpieza si es necesario
            writeLogToFile();
        };
    });
}
