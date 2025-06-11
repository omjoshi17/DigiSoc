window.onload = function () {
    document.getElementById("download-receipt")
        .addEventListener("click", () => {
            const invoice = document.getElementById("receipt");
            const opt = {
                margin: 1,
                filename: 'receipt.pdf',
                image: { type: 'jpeg', quality: 1 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
            };
            html2pdf().from(invoice).set(opt).save();
        });

    document.getElementById("download-btn")
        .addEventListener("click", () => {
            const invoice = document.getElementById("print-content");
            const opt = {
                margin: 1,
                filename: 'bill.pdf',
                image: { type: 'jpeg', quality: 1 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
            };
            html2pdf().from(invoice).set(opt).save();
        });
}
