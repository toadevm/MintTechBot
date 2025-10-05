const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AutomatedPayroll", function () {
    let payroll;
    let owner;
    let employee1;
    let employee2;
    let employee3;
    let mockToken;

    const SECONDS_PER_DAY = 86400;
    const PAYMENT_AMOUNT = ethers.parseEther("1");
    const TOKEN_AMOUNT = ethers.parseUnits("100", 18);

    beforeEach(async function () {
        [owner, employee1, employee2, employee3] = await ethers.getSigners();

        const AutomatedPayroll = await ethers.getContractFactory("AutomatedPayroll");
        payroll = await AutomatedPayroll.deploy();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockToken = await MockERC20.deploy("Mock Token", "MTK", ethers.parseUnits("10000", 18));
    });

    describe("Deployment", function () {
        it("Should set the correct owner", async function () {
            expect(await payroll.owner()).to.equal(owner.address);
        });

        it("Should start with zero employees", async function () {
            expect(await payroll.getEmployeeCount()).to.equal(0);
        });
    });

    describe("Employee Management", function () {
        it("Should add employee correctly", async function () {
            await expect(
                payroll.addEmployee(employee1.address, PAYMENT_AMOUNT, ethers.ZeroAddress, 7)
            ).to.emit(payroll, "EmployeeAdded");

            const emp = await payroll.getEmployee(employee1.address);
            expect(emp.employeeAddress).to.equal(employee1.address);
            expect(emp.paymentAmount).to.equal(PAYMENT_AMOUNT);
            expect(emp.paymentIntervalDays).to.equal(7);
            expect(emp.isActive).to.equal(true);
        });

        it("Should not allow non-owner to add employee", async function () {
            await expect(
                payroll.connect(employee1).addEmployee(employee2.address, PAYMENT_AMOUNT, ethers.ZeroAddress, 7)
            ).to.be.reverted;
        });

        it("Should not add employee with zero address", async function () {
            await expect(
                payroll.addEmployee(ethers.ZeroAddress, PAYMENT_AMOUNT, ethers.ZeroAddress, 7)
            ).to.be.revertedWith("Invalid employee address");
        });

        it("Should not add duplicate employee", async function () {
            await payroll.addEmployee(employee1.address, PAYMENT_AMOUNT, ethers.ZeroAddress, 7);
            await expect(
                payroll.addEmployee(employee1.address, PAYMENT_AMOUNT, ethers.ZeroAddress, 7)
            ).to.be.revertedWith("Employee already exists");
        });

        it("Should remove employee correctly", async function () {
            await payroll.addEmployee(employee1.address, PAYMENT_AMOUNT, ethers.ZeroAddress, 7);
            await expect(payroll.removeEmployee(employee1.address)).to.emit(payroll, "EmployeeRemoved");
            expect(await payroll.getEmployeeCount()).to.equal(0);
        });

        it("Should update employee details", async function () {
            await payroll.addEmployee(employee1.address, PAYMENT_AMOUNT, ethers.ZeroAddress, 7);
            const newAmount = ethers.parseEther("2");
            await expect(
                payroll.updateEmployee(employee1.address, newAmount, 14)
            ).to.emit(payroll, "EmployeeUpdated");

            const emp = await payroll.getEmployee(employee1.address);
            expect(emp.paymentAmount).to.equal(newAmount);
            expect(emp.paymentIntervalDays).to.equal(14);
        });
    });

    describe("ETH Payments", function () {
        beforeEach(async function () {
            await payroll.addEmployee(employee1.address, PAYMENT_AMOUNT, ethers.ZeroAddress, 1);
            await payroll.depositETH({ value: ethers.parseEther("10") });
        });

        it("Should execute ETH payment when due", async function () {
            await time.increase(SECONDS_PER_DAY);

            const balanceBefore = await ethers.provider.getBalance(employee1.address);
            await expect(payroll.executePayment(employee1.address))
                .to.emit(payroll, "PaymentExecuted");
            const balanceAfter = await ethers.provider.getBalance(employee1.address);

            expect(balanceAfter - balanceBefore).to.equal(PAYMENT_AMOUNT);
        });

        it("Should not execute payment before due", async function () {
            await expect(
                payroll.executePayment(employee1.address)
            ).to.be.revertedWith("Payment not due yet");
        });

        it("Should check if payment is due", async function () {
            expect(await payroll.isPaymentDue(employee1.address)).to.equal(false);
            await time.increase(SECONDS_PER_DAY);
            expect(await payroll.isPaymentDue(employee1.address)).to.equal(true);
        });
    });

    describe("Token Payments", function () {
        beforeEach(async function () {
            await payroll.addEmployee(employee1.address, TOKEN_AMOUNT, await mockToken.getAddress(), 1);
            await mockToken.approve(await payroll.getAddress(), ethers.parseUnits("10000", 18));
            await payroll.depositTokens(await mockToken.getAddress(), ethers.parseUnits("1000", 18));
        });

        it("Should execute token payment when due", async function () {
            await time.increase(SECONDS_PER_DAY);

            const balanceBefore = await mockToken.balanceOf(employee1.address);
            await payroll.executePayment(employee1.address);
            const balanceAfter = await mockToken.balanceOf(employee1.address);

            expect(balanceAfter - balanceBefore).to.equal(TOKEN_AMOUNT);
        });
    });

    describe("Batch Payments", function () {
        beforeEach(async function () {
            await payroll.addEmployee(employee1.address, PAYMENT_AMOUNT, ethers.ZeroAddress, 1);
            await payroll.addEmployee(employee2.address, PAYMENT_AMOUNT, ethers.ZeroAddress, 1);
            await payroll.depositETH({ value: ethers.parseEther("10") });
        });

        it("Should execute all payments", async function () {
            await time.increase(SECONDS_PER_DAY);
            await payroll.executeAllPayments();

            expect(await payroll.isPaymentDue(employee1.address)).to.equal(false);
            expect(await payroll.isPaymentDue(employee2.address)).to.equal(false);
        });

        it("Should execute batch payments", async function () {
            await time.increase(SECONDS_PER_DAY);
            await payroll.executeBatchPayments([employee1.address, employee2.address]);

            expect(await payroll.isPaymentDue(employee1.address)).to.equal(false);
            expect(await payroll.isPaymentDue(employee2.address)).to.equal(false);
        });
    });

    describe("Pause/Resume", function () {
        beforeEach(async function () {
            await payroll.addEmployee(employee1.address, PAYMENT_AMOUNT, ethers.ZeroAddress, 1);
            await payroll.depositETH({ value: ethers.parseEther("10") });
        });

        it("Should pause employee", async function () {
            await expect(payroll.pauseEmployee(employee1.address))
                .to.emit(payroll, "EmployeePaused");

            const emp = await payroll.getEmployee(employee1.address);
            expect(emp.isActive).to.equal(false);
        });

        it("Should resume employee", async function () {
            await payroll.pauseEmployee(employee1.address);
            await expect(payroll.resumeEmployee(employee1.address))
                .to.emit(payroll, "EmployeeResumed");

            const emp = await payroll.getEmployee(employee1.address);
            expect(emp.isActive).to.equal(true);
        });

        it("Should pause all payments", async function () {
            await payroll.pauseAllPayments();
            await time.increase(SECONDS_PER_DAY);

            await expect(
                payroll.executePayment(employee1.address)
            ).to.be.reverted;
        });

        it("Should resume all payments", async function () {
            await payroll.pauseAllPayments();
            await payroll.resumeAllPayments();
            await time.increase(SECONDS_PER_DAY);

            await expect(payroll.executePayment(employee1.address))
                .to.emit(payroll, "PaymentExecuted");
        });
    });

    describe("Fund Management", function () {
        it("Should deposit ETH", async function () {
            await expect(payroll.depositETH({ value: ethers.parseEther("5") }))
                .to.emit(payroll, "FundsDeposited");

            expect(await payroll.getContractETHBalance()).to.equal(ethers.parseEther("5"));
        });

        it("Should withdraw ETH", async function () {
            await payroll.depositETH({ value: ethers.parseEther("5") });
            await expect(payroll.withdrawETH(ethers.parseEther("2")))
                .to.emit(payroll, "FundsWithdrawn");

            expect(await payroll.getContractETHBalance()).to.equal(ethers.parseEther("3"));
        });

        it("Should deposit tokens", async function () {
            await mockToken.approve(await payroll.getAddress(), TOKEN_AMOUNT);
            await expect(payroll.depositTokens(await mockToken.getAddress(), TOKEN_AMOUNT))
                .to.emit(payroll, "FundsDeposited");

            expect(await payroll.getContractTokenBalance(await mockToken.getAddress())).to.equal(TOKEN_AMOUNT);
        });

        it("Should withdraw tokens", async function () {
            await mockToken.approve(await payroll.getAddress(), TOKEN_AMOUNT);
            await payroll.depositTokens(await mockToken.getAddress(), TOKEN_AMOUNT);

            const halfAmount = TOKEN_AMOUNT / 2n;
            await expect(payroll.withdrawTokens(await mockToken.getAddress(), halfAmount))
                .to.emit(payroll, "FundsWithdrawn");

            expect(await payroll.getContractTokenBalance(await mockToken.getAddress())).to.equal(halfAmount);
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            await payroll.addEmployee(employee1.address, PAYMENT_AMOUNT, ethers.ZeroAddress, 7);
            await payroll.addEmployee(employee2.address, PAYMENT_AMOUNT, ethers.ZeroAddress, 14);
        });

        it("Should get all employees", async function () {
            const employees = await payroll.getAllEmployees();
            expect(employees.length).to.equal(2);
            expect(employees[0]).to.equal(employee1.address);
            expect(employees[1]).to.equal(employee2.address);
        });

        it("Should get employee count", async function () {
            expect(await payroll.getEmployeeCount()).to.equal(2);
        });

        it("Should get eligible employees", async function () {
            await payroll.depositETH({ value: ethers.parseEther("10") });
            await time.increase(SECONDS_PER_DAY * 7);

            const eligible = await payroll.getEligibleEmployees();
            expect(eligible.length).to.equal(1);
            expect(eligible[0]).to.equal(employee1.address);
        });

        it("Should get next payment date", async function () {
            const nextDate = await payroll.getNextPaymentDate(employee1.address);
            expect(nextDate).to.be.gt(0);
        });
    });

    describe("Edge Cases", function () {
        it("Should handle insufficient ETH balance", async function () {
            await payroll.addEmployee(employee1.address, PAYMENT_AMOUNT, ethers.ZeroAddress, 1);
            await time.increase(SECONDS_PER_DAY);

            await expect(
                payroll.executePayment(employee1.address)
            ).to.be.revertedWith("Insufficient ETH balance");
        });

        it("Should accept ETH via receive function", async function () {
            await owner.sendTransaction({
                to: await payroll.getAddress(),
                value: ethers.parseEther("1")
            });

            expect(await payroll.getContractETHBalance()).to.equal(ethers.parseEther("1"));
        });
    });
});
