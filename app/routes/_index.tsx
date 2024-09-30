import React, { useState, useEffect, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';

export default function UniswapBotDashboard() {
  const [balances, setBalances] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [logs, setLogs] = useState([]);
  const [errors, setErrors] = useState([]);

  const logsEndRef = useRef(null);

  useEffect(() => {
    const eventSource = new EventSource("/sse/uniswap-bot");

    eventSource.addEventListener("balance", (event) => {
      const data = JSON.parse(event.data);
      setBalances((prev) => [...prev.slice(-99), data]);
    });

    eventSource.addEventListener("transaction", (event) => {
      const data = JSON.parse(event.data);
      setTransactions((prev) => [...prev.slice(-99), data]);
    });

    eventSource.addEventListener("log", (event) => {
      const message = event.data;
      setLogs((prev) => [...prev, message]);
    });

    eventSource.addEventListener("error", (event) => {
      const data = JSON.parse(event.data);
      setErrors((prev) => [...prev, data]);
    });

    eventSource.onerror = (err) => {
      console.error("EventSource failed:", err);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // Scroll automático al final de los logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Preparar datos para gráficos
  const balanceData = {
    labels: balances.map((balance) => new Date(balance.timestamp).toLocaleTimeString()),
    datasets: [
      {
        label: 'WETH',
        data: balances.map((balance) => balance.wethBalance),
        borderColor: 'rgba(66, 153, 225, 1)',
        backgroundColor: 'rgba(66, 153, 225, 0.2)',
        fill: true,
      },
      {
        label: 'USDC',
        data: balances.map((balance) => balance.usdcBalance),
        borderColor: 'rgba(72, 187, 120, 1)',
        backgroundColor: 'rgba(72, 187, 120, 0.2)',
        fill: true,
      },
    ],
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Dashboard del Bot de Uniswap</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Gráfico de Balances */}
        <div className="bg-white shadow-md rounded p-4">
          <h2 className="text-xl font-semibold mb-2">Evolución de Balances</h2>
          <Line data={balanceData} />
        </div>

        {/* Últimas Transacciones */}
        <div className="bg-white shadow-md rounded p-4">
          <h2 className="text-xl font-semibold mb-2">Últimas Transacciones</h2>
          <ul className="space-y-2 overflow-y-auto max-h-80">
            {transactions.slice(-10).reverse().map((tx, index) => (
              <li key={index} className="border-b pb-2">
                <span className="font-medium">{tx.type.toUpperCase()}</span> - [{new Date(tx.timestamp).toLocaleTimeString()}]
                <br />
                {tx.amountIn} {tx.tokenIn} → {tx.amountOut} {tx.tokenOut}
                <br />
                <a href={`https://etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                  Ver en Etherscan
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Tabla de Logs en Vivo */}
        <div className="bg-white shadow-md rounded p-4 col-span-1 md:col-span-2">
          <h2 className="text-xl font-semibold mb-2">Logs en Vivo</h2>
          <div className="overflow-y-auto h-64">
            <table className="min-w-full text-sm">
              <tbody>
                {logs.map((log, index) => (
                  <tr key={index} className="border-b">
                    <td className="px-2 py-1 whitespace-nowrap">{log}</td>
                  </tr>
                ))}
                <tr ref={logsEndRef} />
              </tbody>
            </table>
          </div>
        </div>

        {/* Errores */}
        {errors.length > 0 && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded col-span-1 md:col-span-2">
            <strong className="font-bold">Errores:</strong>
            <ul className="list-disc pl-5">
              {errors.map((error, index) => (
                <li key={index}>{error.message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
