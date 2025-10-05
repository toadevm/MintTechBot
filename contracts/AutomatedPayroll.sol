// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract AutomatedPayroll is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    struct Employee {
        address payable employeeAddress;
        uint256 paymentAmount;
        address tokenAddress;
        uint256 paymentIntervalDays;
        uint256 lastPaymentTimestamp;
        bool isActive;
        bool exists;
    }

    mapping(address => Employee) public employees;
    address[] public employeeList;

    uint256 private constant SECONDS_PER_DAY = 86400;
    uint256 private constant MIN_INTERVAL_DAYS = 1;
    uint256 private constant MAX_INTERVAL_DAYS = 365;

    event EmployeeAdded(
        address indexed employeeAddress,
        uint256 paymentAmount,
        address tokenAddress,
        uint256 intervalDays
    );
    event EmployeeRemoved(address indexed employeeAddress);
    event EmployeeUpdated(
        address indexed employeeAddress,
        uint256 paymentAmount,
        uint256 intervalDays
    );
    event PaymentExecuted(
        address indexed employeeAddress,
        uint256 amount,
        address tokenAddress,
        uint256 timestamp
    );
    event EmployeePaused(address indexed employeeAddress);
    event EmployeeResumed(address indexed employeeAddress);
    event FundsDeposited(address indexed tokenAddress, uint256 amount);
    event FundsWithdrawn(address indexed tokenAddress, uint256 amount);

    constructor() Ownable(msg.sender) {}

    modifier employeeExists(address _employeeAddress) {
        require(employees[_employeeAddress].exists, "Employee does not exist");
        _;
    }

    modifier employeeIsActive(address _employeeAddress) {
        require(employees[_employeeAddress].isActive, "Employee is not active");
        _;
    }

    function addEmployee(
        address payable _employeeAddress,
        uint256 _paymentAmount,
        address _tokenAddress,
        uint256 _intervalDays
    ) external onlyOwner {
        require(_employeeAddress != address(0), "Invalid employee address");
        require(!employees[_employeeAddress].exists, "Employee already exists");
        require(_paymentAmount > 0, "Payment amount must be greater than 0");
        require(
            _intervalDays >= MIN_INTERVAL_DAYS && _intervalDays <= MAX_INTERVAL_DAYS,
            "Invalid interval days"
        );

        employees[_employeeAddress] = Employee({
            employeeAddress: _employeeAddress,
            paymentAmount: _paymentAmount,
            tokenAddress: _tokenAddress,
            paymentIntervalDays: _intervalDays,
            lastPaymentTimestamp: block.timestamp,
            isActive: true,
            exists: true
        });

        employeeList.push(_employeeAddress);

        emit EmployeeAdded(_employeeAddress, _paymentAmount, _tokenAddress, _intervalDays);
    }

    function removeEmployee(address _employeeAddress)
        external
        onlyOwner
        employeeExists(_employeeAddress)
    {
        delete employees[_employeeAddress];

        for (uint256 i = 0; i < employeeList.length; i++) {
            if (employeeList[i] == _employeeAddress) {
                employeeList[i] = employeeList[employeeList.length - 1];
                employeeList.pop();
                break;
            }
        }

        emit EmployeeRemoved(_employeeAddress);
    }

    function updateEmployee(
        address _employeeAddress,
        uint256 _paymentAmount,
        uint256 _intervalDays
    ) external onlyOwner employeeExists(_employeeAddress) {
        require(_paymentAmount > 0, "Payment amount must be greater than 0");
        require(
            _intervalDays >= MIN_INTERVAL_DAYS && _intervalDays <= MAX_INTERVAL_DAYS,
            "Invalid interval days"
        );

        Employee storage employee = employees[_employeeAddress];
        employee.paymentAmount = _paymentAmount;
        employee.paymentIntervalDays = _intervalDays;

        emit EmployeeUpdated(_employeeAddress, _paymentAmount, _intervalDays);
    }

    function executePayment(address _employeeAddress)
        external
        nonReentrant
        whenNotPaused
        employeeExists(_employeeAddress)
        employeeIsActive(_employeeAddress)
    {
        require(isPaymentDue(_employeeAddress), "Payment not due yet");
        _executePayment(_employeeAddress);
    }

    function _executePayment(address _employeeAddress) internal {
        Employee storage employee = employees[_employeeAddress];

        uint256 paymentAmount = employee.paymentAmount;
        address tokenAddress = employee.tokenAddress;

        employee.lastPaymentTimestamp = block.timestamp;

        if (tokenAddress == address(0)) {
            require(address(this).balance >= paymentAmount, "Insufficient ETH balance");
            (bool success, ) = employee.employeeAddress.call{value: paymentAmount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20 token = IERC20(tokenAddress);
            require(
                token.balanceOf(address(this)) >= paymentAmount,
                "Insufficient token balance"
            );
            token.safeTransfer(employee.employeeAddress, paymentAmount);
        }

        emit PaymentExecuted(_employeeAddress, paymentAmount, tokenAddress, block.timestamp);
    }

    function executeAllPayments() external nonReentrant whenNotPaused {
        uint256 employeeCount = employeeList.length;
        require(employeeCount > 0, "No employees in system");

        for (uint256 i = 0; i < employeeCount; i++) {
            address employeeAddress = employeeList[i];
            Employee memory employee = employees[employeeAddress];

            if (employee.isActive && isPaymentDue(employeeAddress)) {
                _executePayment(employeeAddress);
            }
        }
    }

    function executeBatchPayments(address[] calldata _employeeAddresses)
        external
        nonReentrant
        whenNotPaused
    {
        require(_employeeAddresses.length > 0, "Empty employee list");

        for (uint256 i = 0; i < _employeeAddresses.length; i++) {
            address employeeAddress = _employeeAddresses[i];

            if (
                employees[employeeAddress].exists &&
                employees[employeeAddress].isActive &&
                isPaymentDue(employeeAddress)
            ) {
                _executePayment(employeeAddress);
            }
        }
    }

    function pauseEmployee(address _employeeAddress)
        external
        onlyOwner
        employeeExists(_employeeAddress)
    {
        require(employees[_employeeAddress].isActive, "Employee already paused");
        employees[_employeeAddress].isActive = false;
        emit EmployeePaused(_employeeAddress);
    }

    function resumeEmployee(address _employeeAddress)
        external
        onlyOwner
        employeeExists(_employeeAddress)
    {
        require(!employees[_employeeAddress].isActive, "Employee already active");
        employees[_employeeAddress].isActive = true;
        emit EmployeeResumed(_employeeAddress);
    }

    function pauseAllPayments() external onlyOwner {
        _pause();
    }

    function resumeAllPayments() external onlyOwner {
        _unpause();
    }

    function depositETH() external payable onlyOwner {
        require(msg.value > 0, "Must send ETH");
        emit FundsDeposited(address(0), msg.value);
    }

    function depositTokens(address _tokenAddress, uint256 _amount) external onlyOwner {
        require(_tokenAddress != address(0), "Invalid token address");
        require(_amount > 0, "Amount must be greater than 0");

        IERC20 token = IERC20(_tokenAddress);
        token.safeTransferFrom(msg.sender, address(this), _amount);

        emit FundsDeposited(_tokenAddress, _amount);
    }

    function withdrawETH(uint256 _amount) external onlyOwner nonReentrant {
        require(_amount > 0, "Amount must be greater than 0");
        require(address(this).balance >= _amount, "Insufficient balance");

        (bool success, ) = payable(owner()).call{value: _amount}("");
        require(success, "ETH withdrawal failed");

        emit FundsWithdrawn(address(0), _amount);
    }

    function withdrawTokens(address _tokenAddress, uint256 _amount)
        external
        onlyOwner
        nonReentrant
    {
        require(_tokenAddress != address(0), "Invalid token address");
        require(_amount > 0, "Amount must be greater than 0");

        IERC20 token = IERC20(_tokenAddress);
        require(token.balanceOf(address(this)) >= _amount, "Insufficient token balance");

        token.safeTransfer(owner(), _amount);

        emit FundsWithdrawn(_tokenAddress, _amount);
    }

    function isPaymentDue(address _employeeAddress) public view returns (bool) {
        Employee memory employee = employees[_employeeAddress];
        if (!employee.exists || !employee.isActive) {
            return false;
        }

        uint256 timeSinceLastPayment = block.timestamp - employee.lastPaymentTimestamp;
        uint256 intervalInSeconds = employee.paymentIntervalDays * SECONDS_PER_DAY;

        return timeSinceLastPayment >= intervalInSeconds;
    }

    function getNextPaymentDate(address _employeeAddress)
        external
        view
        employeeExists(_employeeAddress)
        returns (uint256)
    {
        Employee memory employee = employees[_employeeAddress];
        return
            employee.lastPaymentTimestamp +
            (employee.paymentIntervalDays * SECONDS_PER_DAY);
    }

    function getEmployee(address _employeeAddress)
        external
        view
        employeeExists(_employeeAddress)
        returns (Employee memory)
    {
        return employees[_employeeAddress];
    }

    function getAllEmployees() external view returns (address[] memory) {
        return employeeList;
    }

    function getEmployeeCount() external view returns (uint256) {
        return employeeList.length;
    }

    function getEligibleEmployees() external view returns (address[] memory) {
        uint256 eligibleCount = 0;

        for (uint256 i = 0; i < employeeList.length; i++) {
            if (isPaymentDue(employeeList[i])) {
                eligibleCount++;
            }
        }

        address[] memory eligible = new address[](eligibleCount);
        uint256 index = 0;

        for (uint256 i = 0; i < employeeList.length; i++) {
            if (isPaymentDue(employeeList[i])) {
                eligible[index] = employeeList[i];
                index++;
            }
        }

        return eligible;
    }

    function getContractETHBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getContractTokenBalance(address _tokenAddress) external view returns (uint256) {
        require(_tokenAddress != address(0), "Invalid token address");
        return IERC20(_tokenAddress).balanceOf(address(this));
    }

    receive() external payable {
        emit FundsDeposited(address(0), msg.value);
    }
}
