module.exports = async ({ deployments, network, run }) => {
  console.log("Verifying SimplePaymentReceiver on Ronin Chain...");
  console.log("Network:", network.name);
  console.log("Contract: 0x405792cbed87fbb34afa505f768c8edf8f9504e9");

  if (network.name === "ronin") {
    try {
      console.log("\nSubmitting to Sourcify...");
      await run("sourcify", {
        endpoint: "https://sourcify.roninchain.com/server/",
      });
      console.log("✅ Verification complete!");
      console.log("View: https://app.roninchain.com/address/0x405792cbed87fbb34afa505f768c8edf8f9504e9?t=contract");
    } catch (error) {
      console.error("❌ Verification failed:", error.message);
    }
  }
};

module.exports.tags = ["VerifyRonin"];
module.exports.runAtTheEnd = true;
